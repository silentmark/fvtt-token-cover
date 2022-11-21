/* globals
CONFIG,
game
*/
"use strict";

import { MODULE_ID, FLAGS, COVER_TYPES, MIN_COVER, MAX_COVER } from "./const.js";

/**
 * For DND5e, add the cover to the Token Config
 */
export function addDND5eCoverFeatFlags() {
  // Leave this to Simbul's if active.
  if ( game.system.id !== "dnd5e" || game.modules.get("simbuls-cover-calculator")?.active ) return;

  CONFIG.DND5E.characterFlags.helpersIgnoreCover = {
    name: game.i18n.localize("tokenvisibility.dnd5e.feats.cover.Name"),
    hint: game.i18n.localize("tokenvisibility.dnd5e.feats.cover.Hint"),
    section: "Feats",
    choices: {
      0: game.i18n.localize("tokenvisibility.dnd5e.feats.cover.OptionNone"),
      1: game.i18n.localize("tokenvisibility.dnd5e.feats.cover.OptionHalf"),
      2: game.i18n.localize("tokenvisibility.dnd5e.feats.cover.OptionThreeQuarters"),
      3: game.i18n.localize("tokenvisibility.dnd5e.feats.cover.OptionFull")
    },
    type: Number
  };
}


/**
 * Hook token creation to add the IgnoresCover class.
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
export function createTokenHook(document, options, userId) { // eslint-disable-line no-unused-vars
  if ( !document.object ) return;

  const handler = game.modules.get(MODULE_ID).api.IGNORES_COVER_HANDLER;
  document.object._ignoresCover = new handler(document.object);
}


/* Getters/Setters for ignoring cover
Break into five parts:
- mwak.
- msak
- rwak. (e.g., Sharpshooter)
- rsak  (e.g., Spell sniper)
- all (e.g., actor feat)
*/

export class IgnoresCover {
  /**
   * @param {Token} token
   */
  constructor(token) {
    if ( !this.token.actor ) {
      console.warn(`IgnoresCover: token ${token.name} (token.id) has no actor.`);
    }

    this.token = token;
    this.actor = this.token.actor;
  }

  /**
   * Confirm the cover value is valid.
   * @param {COVER_TYPE} cover
   * @returns {boolean}
   */
  static verifyCoverValue(cover) {
    if ( !cover.between(MIN_COVER, MAX_COVER) ) {
      console.warn(`IgnoresCover requires value between ${MIN_COVER} and ${MAX_COVER}`);
      return false;
    }

    return true;
  }

  /**
   * Helper to get a flag from the actor that returns a COVER_TYPE.
   * @param {string} flag
   * @returns {COVER_TYPE}
   */
  _getCoverFlag(flag) {
    let flagValue = this.actor?.getFlag(MODULE_ID, flag);
    flagValue ??= COVER_TYPES.NONE;
    return flagValue;
  }

  /**
   * Does the token ignore cover at all times?
   * @type {COVER_TYPES}
   */
  get all() { return this._getCoverFlag(FLAGS.COVER.IGNORE.ALL); }

  set all(value) {
    if ( !this.constructor.verifyCoverValue(value) ) return;
    this.token.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.ALL);
  }

  /**
   * Does the token ignore cover for melee weapon attacks?
   * @type {COVER_TYPES}
   */
  get mwak() { return this._getCoverFlag(FLAGS.COVER.IGNORE.MWAK); }

  set mwak(value) {
    if ( !this.constructor.verifyCoverValue(value) ) return;
    this.token.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.MWAK);
  }

  /**
   * Does the token ignore cover for melee spell/magic attacks?
   * @type {COVER_TYPES}
   */
  get msak() { return this._getCoverFlag(FLAGS.COVER.IGNORE.MSAK); }

  set msak(value) {
    if ( !this.constructor.verifyCoverValue(value) ) return;
    this.token.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.MSAK);
  }

  /**
   * Does the token ignore cover for ranged weapon attacks?
   * @type {COVER_TYPES}
   */
  get rwak() { return this._getCoverFlag(FLAGS.COVER.IGNORE.RWAK); }

  set rwak(value) {
    if ( !this.constructor.verifyCoverValue(value) ) return;
    this.token.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.RWAK);
  }

  /**
   * Does the token ignore cover for ranged spell/magic attacks?
   * @type {COVER_TYPES}
   */
  get rsak() { return this._getCoverFlag(FLAGS.COVER.IGNORE.RSAK); }

  set rsak(value) {
    if ( !this.constructor.verifyCoverValue(value) ) return;
    this.token.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.RSAK);
  }
}

/**
 * Class to use with DND5e.
 * Includes compatibility with dnd5ehelpers and midi flags.
 */
export class IgnoresCoverDND5e extends IgnoresCover {

  /**
   * Return the maximum of this module's flag or the dnd5e flag.
   * @type {COVER_TYPE}
   */
  get all() {
    let dndFlag = this.actor?.getFlag("dnd5e", FLAGS.COVER.IGNORE_DND5E);

    // For backwards-compatibility, set to three quarters.
    // Aligned with how Simbul's handles it.
    if ( dndFlag === true || dndFlag === "true" ) dndFlag = COVER_TYPES.MEDIUM;

    return Math.max(super.all, dndFlag);
  }

  /**
   * Update both the dnd5e flag and this module's flag.
   * @type {COVER_TYPE}
   */
  set all(value) {
    if ( !this.constructor.verifyCoverValue(value) ) return;
    super.all = value;

    this.actor.update({
      flags: {
        dnd5e: {
          [FLAGS.COVER.IGNORE_DND5E]: value
        }
      }
    });
  }

  /**
   * Check midi flag; return maximum.
   * @type {COVER_TYPE}
   */
  get rwak() {
    const sharpShooter = this.actor.flags["midi-qol"].sharpShooter ? COVER_TYPES.MEDIUM : COVER_TYPES.NONE;
    return Math.max(super.rwak, sharpShooter);
  }

  /**
   * Check dae flag; return maximum.
   * @type {COVER_TYPE}
   */
  get rsak() {
    const spellSniper = this.actor.flags.dnd5e.spellSniper ? COVER_TYPES.MEDIUM : COVER_TYPES.NONE;
    return Math.max(super.rsak, spellSniper);
  }
}

/**
 * Class to use when Simbul's is active.
 * Defaults to the Simbul's cover for the all getter/setter.
 */
export class IgnoresCoverSimbuls extends IgnoresCoverDND5e {
  constructor(token) {
    if ( !game.modules.get("simbuls-cover-calculator")?.active ) {
      console.warn("IgnoresCoverSimbuls instantiated but Simbul's Cover Calculator is not active.");
    }

    super(token);
  }

  get all() {
    return this.token.ignoresCover();
  }
}
