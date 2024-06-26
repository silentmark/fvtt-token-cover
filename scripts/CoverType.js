/* globals
Color,
CONFIG,
foundry,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { defaultCoverTypes as dnd5eCoverTypes } from "./coverDefaults/dnd5e.js";
import { defaultCoverTypes as pf2eCoverTypes } from "./coverDefaults/pf2e.js";
import { defaultCoverTypes as sfrpgCoverTypes } from "./coverDefaults/sfrpg.js";
import { defaultCoverTypes as genericCoverTypes } from "./coverDefaults/generic.js";
import { Settings } from "./settings.js";
import { MODULE_ID, COVER } from "./const.js";
import { AbstractCoverObject } from "./AbstractCoverObject.js";
import { findSpliceAll, log } from "./util.js";

const NULL_SET = new Set(); // Set intended to signify no items, as a placeholder.

/**
 * @typedef {object} CoverTypeData
 *
 * Object that stores properties for a given cover type.
 * Custom properties are permitted.
 *
 * @prop {string} name                          Name of the category. Will be localized.
 * @prop {string} id                            Id for the category. Must be unique.
 * @prop {number} percentThreshold              A token has cover from an attacker if the attacker cannot
 *                                              see more than this percentage of the token.
 *                                              How visibility is measured is controlled by the Cover Settings.
 * @prop {string} icon                          Icon that represents this category. Displayed on the token.
 * @prop {number|null} tint                     Optional tint applied to the icon
 * @prop {boolean} canOverlap                   If true, this cover can be applied *in addition to* other cover types
 * @prop {ActiveEffect|null} activeEffectData   Data used to create an active effect associated with this cover type
 * @prop {number|null} priority                 When evaluating the percent threshold, higher-priority cover types
 *                                              are evaluated first.
 * @prop {boolean} includeWalls                 Should walls be considered blocking for this category?
 * @prop {boolean} includeTokens                Should tokens be considered blocking for this category?
 */

/* Cover handling

A CoverType represents a defined cover that may apply to tokens. It has an icon that can be
displayed on the token locally. So if a player selects a token, that player only sees a cover
icon for all other tokens that the player can view. (Other tokens on the canvas have the
defined cover but the icon is not viewable.)

A CoverType with priority is evaluated from highest to lowest priority. So if "high cover"
requires that the covered token is ≥ 75% covered from an attacking token, and "medium cover"
requires ≥ 50%, then if "high cover" has higher priority, it will be applied for cover of 60%.
If "medium cover" has priority, then it will be applied for cover of 60%.

If a CoverType has `canOverlap=true`, it can be applied in addition to other cover types. Otherwise,
the highest priority that meets its threshold will be applied. Cover types without priority are
evaluated last, in no particular order.

An active effect ("Cover Effect") can be associated with a CoverType. This allows active effects
to be applied when a token has a certain cover type. Cover Effects are applied locally per-user,
although a Cover Effect in most systems is an ActiveEffect that could be applied to a database.
Applying an active effect via the database is less useful for cover, as it applies to all
tokens equally regardless of user/attacker.
*/


/**
 * Class to manage the cover types.
 * Each instantiation takes CoverTypeData and constructs the cover type.
 * Loading and saving controlled here.
 */
export class CoverType extends AbstractCoverObject {
  // ----- NOTE: Getters, setters, related properties ----- //

  // ----- NOTE: Methods ----- //

  /**
   * Find an existing local document to use for the storage.
   * For cover type, this is an existing stored setting.
   * @returns {Document|object|undefined}
   */
  _findStorageDocument() {
    const doc = this.constructor.storedCoverTypes[this.id];
    if ( !doc || foundry.utils.isEmpty(doc) ) return undefined;
    this.constructor.coverTypesUpdated();

    // Fix tint to always be a Color class.
    if ( !(doc.tint instanceof Color) ) doc.tint = typeof doc.tint === "string"
      ? Color.fromString(doc.tint) : new Color(doc.tint);
    return doc;
  }

  /**
   * Load an async document to use for storage.
   * For cover type, this does nothing, as the setting can be accessed synchronously.
   * @returns {Document|object|undefined}
   */
  async _loadStorageDocument() { return this._findStorageDocument(); }

  /**
   * Create a storage document from scratch.
   * For cover type, this creates the document but does not store it. (Saved to settings later.)
   * @returns {Document|object}
   */
  async _createStorageDocument() {
    this.constructor.coverTypesUpdated();
    return this.constructor.defaultCoverObjectData.get(this.id) ?? this.constructor.newCoverTypeData;
  }

  /**
   * Delete the underlying stored document.
   * For cover type, removes this type's config data from stored settings.
   */
  async _deleteStorageDocument() {
    this.constructor.coverTypesUpdated();
    return this.constructor.removeStoredCoverObjectId(this.id);
  }

  /**
   * Update this object with the given data.
   * Cover Types can be saved to settings by passing an undefined config.
   * @param {object} [config={}]    If config is not provided, update setting with current config.
   */
  async update(config) {
    this.constructor.coverTypesUpdated();
    config ??= this.document;
    const stored = this.constructor.storedCoverTypes;
    stored[this.id] ??= {};
    foundry.utils.mergeObject(stored[this.id], config);
    return this.constructor.addStoredCoverObjectId(this.id, true);
  }

  // ----- NOTE: Cover type specific methods ----- //

  /**
   * Test if this cover type applies to a target token given an attacking token.
   * Use the static coverTypesForToken for more efficient tests for all cover types at once.
   */
  coverTypeApplies(attackingToken, targetToken, _opts = {}) {
    return this.percentCover(attackingToken, targetToken) >= this.document.percentThreshold;
  }

  /**
   * Percent cover given this cover type's settings for a pair of tokens.
   * @param {Token} attackingToken
   * @param {Token} targetToken
   * @returns {number}
   */
  percentCover(attackingToken, targetToken) {
    const { includeWalls, includeTokens } = this.document;
    return attackingToken.tokencover.coverCalculator.percentCover(targetToken, { includeWalls, includeTokens });
  }
  /**
   * Add this cover type to the token.
   * Adds unless already present.
   * Removes others unless canOverlap is true
   * @param {Token} token
   * @returns {boolean} True if change was made.
   */
  addToToken(token) {
    log(`CoverType#addToToken|${token.name}`);
    const icon = this.document.icon;

    // If already present, we are done.
    if ( token.document.effects.some(e => e === icon) ) return false;

    // If this type can overlap, it can be added b/c it is not already present.
    if ( this.document.canOverlap ) {
      log(`CoverType#addToToken|${token.name} adding ${this.name}`);
      token.document.effects.push(icon);
      return true;
    }

    // If this type cannot overlap, then any non-overlapping icons must be removed first.
    const tokenEffectIcons = new Set(token.document.effects);
    const otherCoverTypes = CoverType.coverObjectsMap.values().filter(ct => ct.icon !== icon && !ct.document.canOverlap);
    for ( const otherCoverType of otherCoverTypes ) {
      if ( tokenEffectIcons.has(otherCoverType.icon) ) otherCoverType.removeFromToken(token);
    }

    // Add the new cover type icon to the token.
    log(`CoverType#addToToken|${token.name} adding ${this.name}`);
    token.document.effects.push(icon);
    return true;
  }

  /**
   * Remove this cover type from the token.
   * @param {Token} token
   * @returns {boolean} True if change was made
   */
  removeFromToken(token) {
    const change = token.document.effects.some(e => e === this.icon);
    if ( change ) {
      log(`CoverType#addToToken|${token.name} removing ${this.name}`);
      findSpliceAll(token.document.effects, e => e === this.icon);
    }
    return change;
  }

  /**
   * Add cover effects linked to this type to token.
   * @param {Token} token
   */
  addCoverEffectsToToken(token, update = true) {
    CONFIG[MODULE_ID].CoverEffect.coverObjectsMap
      .filter(ce => ce.coverTypes.some(ct => ct === this))
      .forEach(ce => ce.addToActorLocally(token, update));
  }

  // ----- NOTE: Static: Track Cover types ----- //
  /** @type {Map<string,CoverType>} */
  static coverObjectsMap = new Map();

  /** @type {CoverType[]} */
  static #coverTypesOrdered = [];

  // See https://stackoverflow.com/questions/75962400/why-is-access-to-private-static-members-through-a-subclass-forbidden
  static get coverTypesOrdered() {
    if ( CoverType.#coverTypesModified ) CoverType.#updateCoverTypesOrder();
    return CoverType.#coverTypesOrdered;
  }

  /** @type {CoverType[]} */
  static #coverTypesUnordered = [];

  static get coverTypesUnordered() {
    if ( CoverType.#coverTypesModified ) CoverType.#updateCoverTypesOrder();
    return CoverType.#coverTypesUnordered;
  }

  /**
   * Track if cover types are updated and re-order accordingly.
   * @type {boolean}
   */
  static #coverTypesModified = true;

  static coverTypesUpdated() { CoverType.#coverTypesModified ||= true;  }

  static #updateCoverTypesOrder() {
    CoverType.#coverTypesOrdered.length = 0;
    CoverType.#coverTypesUnordered.length = 0;
    for ( const coverType of this.coverObjectsMap.values() ) {
      if ( !coverType.document.priority ) CoverType.#coverTypesUnordered.push(coverType);
      else CoverType.#coverTypesOrdered.push(coverType);
    }
    CoverType.#coverTypesOrdered.sort((a, b) => b.document.priority - a.document.priority);
    CoverType.#coverTypesModified = false;
  }

  // ----- NOTE: Static getter, setters, related properties ----- //

  /** @type {string} */
  static get settingsKey() { return Settings.KEYS.COVER_TYPES.DATA; }

  /** @type {object} */
  static get storedCoverTypes() {
    return Settings.get(this.settingsKey);
  }

  /** @type {object} */
  static get newCoverTypeData() {
    return {
      name: `${MODULE_ID}.cover.tokensBlock`,
      percentThreshold: 1,
      icon: "modules/tokencover/assets/shield_virus_gray.svg",
      tint: new Color(0),
      canOverlap: true,
      includeWalls: false,
      includeTokens: true,
      priority: null
    }
  }

  /**
   * Get default cover types for different systems.
   * @type {Map<string, object>} Map of objects with keys corresponding to cover type object ids.
   */
  static get defaultCoverObjectData() {
    switch ( game.system.id ) {
      case "dnd5e": return dnd5eCoverTypes;
      case "pf2e": return pf2eCoverTypes;
      case "sfrpg": return sfrpgCoverTypes;
      default: return genericCoverTypes;
    }
  }
  // ----- NOTE: Static methods ----- //

  /**
   * Set the cover object id from settings object.
   * @param {string} id
   * @param {boolean} [update=false]    If true, update the stored cover object data for this id.
   */
  static async addStoredCoverObjectId(id, update = false) {
    // Because the entire Cover Type is stored, set the entire value.
    if ( !update ) {
      const storedIds = this.storedCoverObjectIds;
      if ( storedIds.has(id) ) return;
    }

    const coverType = this.coverObjectsMap.get(id);
    if ( !coverType ) return;

    const storedObj = this.storedCoverTypes;
    storedObj[id] = coverType.document;

    return Settings.set(this.settingsKey, storedObj);
  }

  /**
   * Remove the cover object id from settings object.
   * @param {string} id
   */
  static async removeStoredCoverObjectId(id) {
    // Because the entire Cover Type is stored, remove the entire value.
    const storedIds = this.storedCoverObjectIds;
    if ( !storedIds.has(id) ) return;

    const storedObj = this.storedCoverTypes;
    delete storedObj[id];
    return Settings.set(this.settingsKey, storedObj);
  }



  // ----- NOTE: Static cover type specific methods ----- //

  /**
   * Replace cover types on token with these.
   * @param {Token} token
   * @param {CoverType[]|Set<CoverType>} coverTypes
   * @returns {boolean} True if a change was made.
   */
  static replaceCoverTypes(token, coverTypes = []) {
    if ( !(coverTypes instanceof Set) ) coverTypes = new Set(coverTypes);

    if ( !coverTypes.size ) {
      if ( !token.document.effects.length ) return false;
      token.document.effects.length = 0;
      return true;
    }

    // Remove all cover types in the array that are not the wanted cover types.
    const tokenEffectIcons = new Set(token.document.effects);
    const toKeep = coverTypes.map(ct => ct.icon);
    const toRemove = tokenEffectIcons.difference(toKeep);
    const changed = toRemove.size
    if ( changed ) findSpliceAll(token.document.effects, e => toRemove.has(e));

    // Add each of the cover types.
    const res = coverTypes.values().reduce((acc, ct) => {
      const out = ct.addToToken(token);
      return acc || out;
    }, false);
    return res || changed;
  }

  /**
   * Determine minimum cover types for a token from a group of attacking tokens.
   * @param {Token} targetToken
   * @param {Token[]} attackingTokens
   * @returns {Set<CoverType>}
   */
  static minimumCoverFromAttackers(targetToken, attackingTokens = []) {
    if ( !attackingTokens.length ) return NULL_SET;

    // For priority cover, smallest priority wins.
    // For other cover, only if this token has that cover from all attackers.
    let minCoverType;
    let otherCoverTypes;
    for ( const attackingToken of attackingTokens ) {
      const coverTypes = targetToken.tokencover.coverTypesFromAttacker(attackingToken);
      const otherTypes = new Set();
      coverTypes.forEach(ct => {
        if ( !ct.priority ) otherTypes.add(ct);
        else if ( (typeof minCoverType === "undefined") || (minCoverType.priority > ct.priority) ) minCoverType = ct;
      })

      if ( !otherCoverTypes ) otherCoverTypes = otherTypes;
      else otherCoverTypes = otherCoverTypes.intersection(otherTypes);
    }

    minCoverType = new Set(minCoverType ? [minCoverType] : []);
    otherCoverTypes ||= Set.NULL_SET;
    return minCoverType.union(otherCoverTypes);
  }

  /**
   * Determine what cover types apply to a target token given an attacking token.
   * @param {Token} attackingToken
   * @param {Token} targetToken
   * @returns {Set<CoverType>}
   */
  static coverTypesForToken(attackingToken, targetToken, opts) {
    const types = new Set();

    // Test cover types in priority order.
    for ( const type of this.coverTypesOrdered ) {
      const typeApplies = type.coverTypeApplies(attackingToken, targetToken, opts);
      if ( typeApplies ) {
        types.add(type);
        break;
      }
    }

    // Test cover types without a set priority.
    for ( const type of this.coverTypesUnordered ) {
      // If there is already a type, cannot use a non-overlapping type.
      if ( !type.document.canOverlap && types.length ) continue;
      if ( type.coverTypeApplies(attackingToken, targetToken, opts) ) types.add(type);
    }
    return types;
  }
}


COVER.TYPES = CoverType.coverObjectsMap;

// ----- NOTE: Helper functions ----- //


// Actor sizes, from smallest to largest, in pf2e.
// See CONFIG.PF2E.actorSizes
const ACTOR_SIZES = {
  tiny: 1,
  sm: 2,
  med: 3,
  lg: 4,
  huge: 5,
  grg: 6
};
Object.entries(ACTOR_SIZES).forEach(([key, value]) => ACTOR_SIZES[value] = key);

/**
 * Specialized handling of cover types in dnd5e.
 */
export class CoverTypeDND5E extends CoverType {
  /**
   * Determine what cover types apply to a target token given an attacking token.
   * For dnd5e, an action type is assumed or passed through the opts object.
   * Some tokens can ignore certain action types.
   * @param {Token} attackingToken
   * @param {Token} targetToken
   * @param {object} [opts]           Options used to determine cover types for specific tokens
   * @param {CONFIG.DND5E.itemActionTypes} [opts.actionType]    Type of action the attacker is taking
   * @returns {coverType[]}
   */
  static coverTypesForToken(attackingToken, targetToken, opts = {}) {
    const coverTypes = super.coverTypesForToken(attackingToken, targetToken, opts);
    if ( !coverTypes.size ) return coverTypes;

    // Check if the cover type(s) should be ignored.
    const ignoresCover = attackingToken.tokencover.ignoresCover?.[opts.actionType ?? "all"];
    if ( !ignoresCover ) return coverTypes;
    for ( const coverType of coverTypes ) {
      if ( coverType.document.percentThreshold <= ignoresCover ) coverTypes.delete(coverType);
    }
    return coverTypes;
  }

  /**
   * Test if this cover type applies to a target token given an attacking token.
   * Use the static coverTypesForToken for more efficient tests for all cover types at once.
   */
  coverTypeApplies(attackingToken, targetToken, opts = {}) {
    // Check if this cover type should be ignored.
    const ignoresCover = attackingToken.tokencover.ignoresCover?.[opts.actionType ?? "all"];
    if ( ignoresCover && ignoresCover >= this.document.percentThreshold ) return false;
    return super.coverTypeApplies(attackingToken, targetToken, opts);
  }
}

/**
 * Specialized handling of cover types in pf2e.
 */
export class CoverTypePF2E extends CoverType {
  /**
   * Determine what cover types apply to a target token given an attacking token.
   * For pf2e, if lesser cover has been assigned, it will upgrade to standard cover
   * if a blocking creature is 2+ sizes larger.
   * See https://2e.aonprd.com/Rules.aspx?ID=2373
   * @param {Token} attackingToken
   * @param {Token} targetToken
   * @returns {coverType[]}
   */
  static coverTypesForToken(attackingToken, targetToken, opts) {
    const types = super.coverTypesForToken(attackingToken, targetToken, opts);
    if ( !types.size ) return types;

    // If we don't have a lesser or standard cover defined, return.
    // If types does not have lesser cover, nothing to upgrade; return.
    const standardCover = this.coverObjectsMap.get(`[MODULE_ID].pf2e.standard`);
    const lesserCover = this.coverObjectsMap.get(`[MODULE_ID].pf2e.lesser`);
    if ( !standardCover || !lesserCover || !types.has(lesserCover) ) return types;

    // Convert lesser cover to standard cover if the blocking creature is 2+ larger.
    const targetSize = ACTOR_SIZES[targetToken.system.traits.size.value] ?? ACTOR_SIZES.med;
    const attackerSize = ACTOR_SIZES[attackingToken.system.traits.size.value] ?? ACTOR_SIZES.med;
    const upgradeSize = Math.max(targetSize, attackerSize) + 1;
    for ( const token of attackingToken.tokencover.coverCalculator.calc.blockingObjects.tokens ) {
      const blockingTokenSize = ACTOR_SIZES[token.system.traits.size.value] ?? ACTOR_SIZES.med;
      if ( blockingTokenSize > upgradeSize ) {
        types.delete(lesserCover);
        types.add(standardCover);
        break;
      }
    }
    return types;
  }
}
