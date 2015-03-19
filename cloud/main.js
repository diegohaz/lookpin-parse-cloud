var _ = require('underscore');
var names = require('cloud/names.js');

/**
 * Validate user and set defaults
 *
 * @todo Validate feeling and nickname
 */
Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  var nickname = request.object.get('nickname');
  var feeling = request.object.get('feeling');

  // Defaults
  request.object.get('setup')     || request.object.set('setup', false);
  request.object.get('echoed')    || request.object.set('echoed', []);
  request.object.get('commented') || request.object.set('commented', []);
  request.object.get('removed')   || request.object.set('removed', []);
  request.object.get('following') || request.object.set('following', []);
  request.object.get('language')  || request.object.set('language', 'en');

  response.success();
});

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
 * @todo Validate feeling
 *
 * @param {string} [language]
 * @param {string} [feeling]
 * @param {int} [limit=1] Number of nicknames to return
 *
 * @response {string[]} List of nicknames
 */
Parse.Cloud.define('getNicknames', function(request, response) {
  // Params
  var lang = request.params.language || request.user.get('language') || 'en';
  var feeling = request.params.feeling || request.user.get('feeling');
  var limit = request.params.limit || 1;

  // Validate
  if (!(lang in names.nouns))
    return response.error('Invalid language');

  // Nicknames
  var adjectives = names.adjectives[lang][feeling];
  var nouns = names.nouns[lang];
  var nicknames = [];

  // Iteration
  for (var i = 0; i < limit; i++) {
    var adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    var noun = nouns[Math.floor(Math.random() * nouns.length)];
    var nickname = adjective + ' ' + noun;

    // Capitalize nickname
    nickname = nickname.replace(/(?:^|\s)\S/g, function(a) {
      return a.toUpperCase();
    });

    nicknames.push(nickname);
  }

  response.success(nicknames);
});

/**
 * Create a shout
 *
 * @todo Validate nickname and feeling
 *
 * @param {string} content
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('shout', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var content = request.params.content;
  var user = request.user;

  // Empty validations
  if (!user)                  return response.error('Empty user');
  if (!user.get('nickname'))  return response.error('Empty nickname');
  if (!user.get('location'))  return response.error('Empty location');
  if (!user.get('place'))     return response.error('Empty place');
  if (!user.get('feeling'))   return response.error('Empty feeling');
  if (!content)               return response.error('Empty content');

  // More validations
  if (content.length > 255) {
    return response.error('Content should not be larger than 255 characters');
  }

  // Object
  var shout = new Parse.Object('Shout');

  // Fetch place
  user.get('place').fetch().then(function(place) {
    shout.set('user', user);
    shout.set('nickname', user.get('nickname'));
    shout.set('location', user.get('location'));
    shout.set('place', user.get('place'));
    shout.set('feeling', user.get('feeling'));
    shout.set('content', content);
    shout.set('echoes', 0);
    shout.set('comments', 0);

    return shout.save();
  }).then(function(shout) {
    var place = user.get('place');

    place.increment('shouts');
    place.save();

    response.success();
  }, response.error);
});

/**
 * Comment a shout
 *
 * @todo Validate nickname
 *
 * @param {string} shoutId
 * @param {string} content
 *
 * @response {Parse.Object} Comment object
 */
Parse.Cloud.define('comment', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var shoutId = request.params.should;
  var content = request.params.content;
  var user = request.user;

  // Empty validations
  if (!user)                  return response.error('Empty user');
  if (!user.get('nickname'))  return response.error('Empty nickname');
  if (!user.get('location'))  return response.error('Empty location');
  if (!user.get('place'))     return response.error('Empty place');
  if (!content)               return response.error('Empty content');

  // More validations
  if (content.length > 255) {
    return response.error('Content should not be larger than 255 characters');
  }

  // Object
  var comment = new Parse.Object('Comment');
  var shout = new Parse.Object('Shout');
  shout.id = shoutId;

  user.get('place').fetch().then(function(place) {
    return shout.fetch();
  }).then(function(shout) {
    comment.set('shout', shout);
    comment.set('user', user);
    comment.set('nickname', user.get('nickname'));
    comment.set('location', user.get('location'));
    comment.set('place', user.get('place'));
    comment.set('content', content);

    return comment.save();
  }).then(function(comment) {
    shout.increment('comments');
    shout.save();

    response.success(comment);
  }, response.error);
});

/**
 * Echo a shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('echo', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var shoutId = request.params.shoutId;
  var user = request.user;

  // Object
  var shout = new Parse.Object('Shout');
  shout.id = shoutId;

  // Echo
  shout.fetch().then(function(shout) {
    // Verify if user already echoed the shout
    var echoed = _.findWHere(user.get('echoed'), {id: shout.id});

    if (!echoed) {
      shout.increment('echoes');
      user.addUnique('echoed', shout);
      user.addUnique('following', shout);
      user.set('feeling', shout.get('feeling'));

      return Parse.Object.saveAll([shout, user]);
    } else {
      return Parse.Promise.error('User cannot echo a shout twice');
    }
  })
  .then(function() {
    response.success(shout);
  }, function(error) {
    response.error(error.message);
  });
});