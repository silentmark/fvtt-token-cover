/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, MODULE_ID } from "./const.js";

// Patches for the ActiveEffect class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * When considering creating an active cover effect, do not do so if it already exists.
 * @param {Document} document                     The pending document which is requested for creation
 * @param {object} data                           The initial data object provided to the document creation request
 * @param {DocumentModificationContext} options   Additional options which modify the creation request
 * @param {string} userId                         The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                        Explicitly return false to prevent creation of this Document
 */
function preCreateActiveEffect(activeEffect, _data, _options, _userId) {
  // Is the activeEffect a cover status?
  const coverEffectId = activeEffect.getFlag(MODULE_ID, FLAGS.COVER_EFFECT_ID);
  if ( !coverEffectId ) return true;

  // Does the status effect already exist?
  const actor = activeEffect.parent;
  if ( !actor || !actor.effects ) return true;
  for ( const effect of actor.effects ) {
    if ( effect.getFlag(MODULE_ID, FLAGS.COVER_EFFECT_ID) === coverEffectId ) return false;
  }
  return true;
}

PATCHES.BASIC.HOOKS = { preCreateActiveEffect };


// ----- NOTE: Static Wraps ----- //

/**
 * Wrap ActiveEffect._onCreateDocuments
 * When creating an active cover effect, remove all other cover effects.
 * Cannot use createActiveEffectHook b/c it is not async.
 *
 */
async function _onCreateDocuments(wrapper, documents, context) {
  const res = await wrapper(documents, context);

//   for ( const effect of documents ) {
//     // If the effect already exists (or cannot be found) effect might be undefined.
//     if ( !effect || !effect.statuses || !effect.parent ) continue;
//
//     // Are there cover effects present for this document?
//     const docCoverStatuses = effect.statuses.intersection(COVER.IDS.ALL);
//     if ( !docCoverStatuses.size ) continue;
//
//     // Do the existing actor statuses need to be removed?
//     const actor = effect.parent;
//     const coverStatuses = actor.statuses?.intersection(COVER.IDS.ALL) ?? Set.NULL_SET;
//     const toRemove = coverStatuses.difference(docCoverStatuses);
//     if ( !toRemove.size ) continue;;
//
//     // Remove all cover statuses except the activeEffect status
//     // ActiveEffect actor does not point to specific token for linked so use getActiveTokens
//     const tokenDocs = actor.getActiveTokens(false, true);
//
//     const promises = [];
//     tokenDocs.forEach(tokenD => {
//       promises.push(...toRemove.map(id => tokenD.toggleActiveEffect({ id }, { active: false }))); // Async
//     });
//     await Promise.allSettled(promises);
//   }

  return res;
}

PATCHES.BASIC.STATIC_WRAPS = { _onCreateDocuments };
