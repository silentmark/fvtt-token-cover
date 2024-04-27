/* globals
Application,
CONFIG,
foundry,
game,
ItemDirectory,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { Settings } from "./settings.js";
import { AbstractCoverObject } from "./AbstractCoverObject.js";
import { AsyncQueue } from "./AsyncQueue.js";
import { CoverType } from "./CoverType.js";
import { log } from "./util.js";
import { defaultCoverEffects as dnd5eCoverEffects } from "./coverDefaults/dnd5e.js";
import { defaultCoverEffects as pf2eCoverEffects } from "./coverDefaults/pf2e.js";
import { defaultCoverEffects as sfrpgCoverEffects } from "./coverDefaults/sfrpg.js";
import { defaultCoverEffects as genericCoverEffects } from "./coverDefaults/generic.js";

// Patches to remove the cover effect item from the sidebar tab.
export const PATCHES_SidebarTab = {};
export const PATCHES_ItemDirectory = {};
PATCHES_SidebarTab.COVER_EFFECT = {};
PATCHES_ItemDirectory.COVER_EFFECT = {};

/**
 * Remove the cover effects item from sidebar so it does not display.
 * From https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/ui/remove-custom-item-from-sidebar.js#L3
 * @param {ItemDirectory} dir
 */
function removeCoverEffectsItemFromSidebar(dir) {
  if ( !(dir instanceof ItemDirectory) ) return;
  const id = CoverEffect.COVER_EFFECTS_ITEM;
  if ( !id ) return;
  const li = dir.element.find(`li[data-document-id="${id}"]`);
  li.remove();
}

PATCHES_SidebarTab.COVER_EFFECT.HOOKS = { changeSidebarTab: removeCoverEffectsItemFromSidebar };
PATCHES_ItemDirectory.COVER_EFFECT.HOOKS = { renderItemDirectory: removeCoverEffectsItemFromSidebar };

/**
 * Handles applying effects to tokens that should be treated as cover.
 * Generic as to how exactly the effect is stored and applied, but presumes it is stored in a document.
 * Applies the cover effect to tokens.
 * Imports/exports effect data.
 * Stores/retrieves effect data.
 * Sets up default effects.
 */
export class CoverEffect extends AbstractCoverObject {

  // ----- NOTE: Getters, setters, and related properties ----- //

  /** @type {string[]} */
  get #coverTypesArray() { return this.document.flags[MODULE_ID][FLAGS.COVER_TYPES] ?? []; }

  /** @type {CoverType[]} */
  get coverTypes() {
    return this.#coverTypesArray.map(typeId => CONFIG[MODULE_ID].CoverType.coverObjectsMap.get(typeId));
  }

  set coverType(value) {
    if ( typeof value === "string" ) value = CONFIG[MODULE_ID].CoverType.coverObjectsMap.get(value);
    if ( !(value instanceof CoverType) ) {
      console.error("CoverEffect#coverType must be a CoverType or CoverType id.");
      return;
    }
    this.document.flags[MODULE_ID][FLAGS.COVER_TYPE] = value.document.id;
  }

  /**
   * Get data used to construct a Cover Effect document.
   */
  get documentData() {
    const data = this.toJSON();
    data._id = foundry.utils.randomID();
    data.name ??= game.i18n.format("tokencover.phrases.xCoverEffect", { cover: game.i18n.localize(data.name) });
    return this.constructor._localizeDocumentData(data);
  }

  /**
   * Data used when dragging a cover effect to an actor sheet.
   */
  get dragData() {
    return {
      name: this.name,
      type: "Item",
      data: this.documentData
    };
  }

  /** @type {object|undefined} */
  get defaultCoverObjectData() {
    const data = super.defaultCoverObjectData?.data;
    if ( !data ) return undefined;

    // Confirm that necessary flags are present.
    data.flags ??= {};
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][FLAGS.COVER_EFFECT_ID] ??= this.id;
    data.flags[MODULE_ID][FLAGS.COVER_TYPES] ??= [];

    // Confirm there is no id property, which can conflict with active effect id getter.
    delete data.id;

    return data;
  }

  // ----- NOTE: Methods ----- //

  /**
   * Update this object with the given data.
   * @param {object} [config={}]
   */
  async update(config = {}) { return this.document.update(config); }

  /**
   * Export this cover type data to JSON.
   * @returns {object}
   */
  toJSON() { return this.document.toJSON(); }

  /**
   * Save a json file for this cover type.
   */
  exportToJSON() { this.document.exportToJSON(); }

  /**
   * Render the cover effect configuration window.
   */
  async renderConfig() { return this.document.sheet.render(true); }

  // ----- NOTE: Methods specific to cover effects ----- //

  /**
   * Add a single cover type to this effect.
   * @param {CoverType|string} coverType      CoverType object or its id.
   */
  _addCoverType(coverType) {
    if ( typeof coverType === "string" ) coverType = CONFIG[MODULE_ID].CoverType.coverObjectsMap.get(coverType);
    if ( !(coverType instanceof CoverType) ) {
      console.error("CoverEffect#coverType must be a CoverType or CoverType id.");
      return;
    }
    this.#coverTypesArray.push(coverType.id);
  }

  /**
   * Remove a single cover type.
   * @param {CoverType|string} coverType      CoverType object or its id.
   */
  _removeCoverType(coverType) {
    if ( typeof coverType === "string" ) coverType = CONFIG[MODULE_ID].CoverType.coverObjectsMap.get(coverType);
    if ( !(coverType instanceof CoverType) ) {
      console.error("CoverEffect#coverType must be a CoverType or CoverType id.");
      return;
    }
    this.#coverTypesArray.findSplice(ct => ct.id === coverType.id);
  }

  /**
   * Clear all cover types
   */
  _removeAllCoverTypes() { this.#coverTypesArray.length = 0; }

  /**
   * Test if the local effect is already on the actor.
   * Must be handled by child class.
   * @param {Actor} actor
   * @returns {boolean} True if local effect is on the actor.
   */
  _localEffectOnActor(_actor) {
    console.error("CoverEffect#_localEffectOnActor must be handled by child class.");
  }

  /**
   * Add the effect locally to an actor.
   * @param {Token|Actor} actor
   * @param {boolean} Returns true if added.
   */
  addToActorLocally(actor, update = true) {
    if ( actor instanceof Token ) actor = actor.actor;
    log(`CoverEffect#addToActorLocally|${actor.name} ${this.name}`);

    if ( this._localEffectOnActor(actor) ) return false;
    const newId = this._addToActorLocally(actor);
    if ( !newId ) return false;
    this.constructor._documentIds.set(newId, this);
    if ( update ) refreshActorCoverEffect(actor);
    return true;
  }

  /**
   * Add the effect locally to an actor.
   * @param {Token|Actor} actor
   * @returns {boolean} Returns true if added.
   */
  _addToActorLocally(_actor) {
    console.error("CoverEffect#_addToActorLocally must be handled by child class.");
  }

  /**
   * Remove the effect locally from an actor.
   * @param {Actor} actor
   * @param {boolean} Returns true if change was required.
   */
  removeFromActorLocally(actor, update = true) {
    log(`CoverEffect#removeFromActorLocally|${actor.name} ${this.name}`);
    if ( actor instanceof Token ) actor = actor.actor;
    if ( !this._localEffectOnActor(actor) ) return false;

    // Remove documents associated with this cover effect from the actor.
    const removedIds = this._removeFromActorLocally(actor);
    if ( !removedIds.length ) return false;
    removedIds.forEach(id => this.constructor.documentIds.delete(id));
    if ( update ) refreshActorCoverEffect(actor);
    return true;
  }

  /**
   * Remove the effect locally from an actor.
   * Presumes the effect is on the actor.
   * @param {Actor} actor
   * @returns {boolean} Returns true if removed.
   */
  _removeFromActorLocally(_actor) {
    console.error("CoverEffect#_addToActorLocally must be handled by child class.");
  }

  // ----- NOTE: Static: Track Cover effects ----- //
  /** @type {Map<string,CoverType>} */
  static coverObjectsMap = new Map();

  // ----- NOTE: Other static getters, setters, related properties ----- //

  /** @type {string} */
  static get settingsKey() { return Settings.KEYS.COVER_EFFECTS.DATA; }

  /**
   * Link document ids (for effects on actors) to this effect.
   * Makes it easier to determine if this cover effect has been applied to an actor.
   * @type {Map<string, CoverEffect>}
   */
  static _documentIds = new Map();

  /**
   * Get default cover types for different systems.
   * @returns {Map<string, object>} Map of objects with keys corresponding to cover type object ids.
   */
  static get defaultCoverObjectData() {
    switch ( game.system.id ) {
      case "dnd5e": return dnd5eCoverEffects;
      case "pf2e": return pf2eCoverEffects;
      case "sfrpg": return sfrpgCoverEffects;
      default: return genericCoverEffects;
    }
  }

  // ----- NOTE: Static methods ----- //

  // ----- NOTE: Static methods specific to cover effects ----- //

  /**
   * Localize document data. Meant for subclasses that are aware of the document structure.
   * @param {object} coverEffectData
   * @returns {object} coverEffectData
   */
  static _localizeDocumentData(coverEffectData) { return coverEffectData; }

  /**
   * Retrieve all Cover Effects on the actor.
   * @param {Token|Actor} actor
   * @returns {CoverEffect[]} Array of cover effects on the actor.
   */
  static allLocalEffectsOnActor(actor) {
    if ( actor instanceof Token ) actor = actor.actor;
    return this._allLocalEffectsOnActor(actor);
  }

  /**
   * Retrieve all Cover Effects on the actor.
   * @param {Actor} actor
   * @returns {CoverEffect[]} Array of cover effects on the actor.
   */
  static _allLocalEffectsOnActor(actor) {
    return this.coverObjectsMap.values()
      .filter(ce => ce._localEffectOnActor(actor))
  }

  /**
   * Replace local cover effects on token with these.
   * @param {Token|Actor} actor
   * @param {CoverEffect[]|Set<CoverEffect>} coverEffects
   */
  static replaceLocalEffectsOnActor(actor, coverEffects = new Set()) {
    log(`CoverEffect#replaceLocalEffectsOnActor|${actor.name}`);

    if ( actor instanceof Token ) actor = actor.actor;
    if ( !(coverEffects instanceof Set) ) coverEffects = new Set(coverEffects);
    const previousEffects = new Set(this.allLocalEffectsOnActor(actor));
    if ( coverEffects.equals(previousEffects) ) return;

    // Filter to only effects that must change.
    const toRemove = previousEffects.difference(coverEffects);
    const toAdd = coverEffects.difference(previousEffects);
    if ( !(toRemove.size || toAdd.size) ) return;

    // Remove unwanted effects then add new effects.
    previousEffects.forEach(ce => ce.removeFromActorLocally(actor, false))
    coverEffects.forEach(ce => ce.addToActorLocally(actor, false));

    // At least on effect should have been changed, so refresh actor.
    refreshActorCoverEffect(actor);
  }
}

// ----- NOTE: Helper functions ----- //

/**
 * Refresh the actor so that the local cover effect is used and visible.
 */
function refreshActorCoverEffect(actor) {
  log(`CoverEffect#refreshActorCoverEffect|${actor.name}`);
  actor.prepareData(); // Trigger active effect update on the actor data.
  queueSheetRefresh(actor);
}

/**
 * Handle multiple sheet refreshes by using an async queue.
 * If the actor sheet is rendering, wait for it to finish.
 */
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const renderQueue = new AsyncQueue();

const queueObjectFn = function(ms, actor) {
  return async function rerenderActorSheet() {
    log(`CoverEffect#refreshActorCoverEffect|Testing sheet for ${actor.name}`);

    // Give up after too many iterations.
    const MAX_ITER = 10;
    let iter = 0;
    while ( iter < MAX_ITER && actor.sheet?._state === Application.RENDER_STATES.RENDERING ) {
      iter += 1;
      await sleep(ms);
    }
    if ( actor.sheet?.rendered ) {
      log(`CoverEffect#refreshActorCoverEffect|Refreshing sheet for ${actor.name}`);
      await actor.sheet.render(true);
    }
  }
}

function queueSheetRefresh(actor) {
  log(`CoverEffect#refreshActorCoverEffect|Queuing sheet refresh for ${actor.name}`);
  const queueObject = queueObjectFn(100, actor);
  renderQueue.enqueue(queueObject); // Could break up the queue per actor but probably unnecessary?
}


