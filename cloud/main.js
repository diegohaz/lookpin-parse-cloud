// Models
require('cloud/data/user.js');
require('cloud/data/shout.js');
require('cloud/data/comment.js');
require('cloud/data/place.js');

var names     = require('cloud/modules/names.js');
var validate  = require('cloud/modules/validate.js');

/**
 * Get adjectives
 *
 * @param {string} [language]
 *
 * @response {Object[]} List of feelings with array of adjectives
 */
Parse.Cloud.define('getAdjectives', function(request, response) {
  // Params
  var lang = request.params.language || request.user.get('language') || 'en';

  if (lang in names.adjectives) {
    response.success(names.adjectives[lang]);
  } else {
    response.error('Invalid language');
  }
});

/**
 * Get nicknames
 *
 * @param {string} [language]
 * @param {string} [feeling]
 * @param {int} [limit=1] Number of nicknames to return
 *
 * @response {string[]} List of nicknames
 */
Parse.Cloud.define('getNicknames', function(request, response) {
  // Params
  var lang    = request.params.language || request.user.get('language') || 'en';
  var feeling = request.params.feeling  || request.user.get('feeling');
  var limit   = request.params.limit    || 1;

  // Validations
  if (!validate.feeling(feeling)) {
    return response.error('Invalid feeling');
  }

  if (!(lang in names.nouns)) {
    return response.error('Invalid language');
  }

  // Nicknames
  var adjectives  = names.adjectives[lang][feeling];
  var nouns       = names.nouns[lang];
  var nicknames   = [];

  // Iteration
  for (var i = 0; i < limit; i++) {
    var adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    var noun      = nouns[Math.floor(Math.random() * nouns.length)];
    var nickname  = adjective + ' ' + noun;

    // Capitalize nickname
    nickname = nickname.replace(/(?:^|\s)\S/g, function(a) {
      return a.toUpperCase();
    });

    nicknames.push(nickname);
  }

  response.success(nicknames);
});