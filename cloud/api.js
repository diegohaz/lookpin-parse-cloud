var _         = require('underscore');
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

/**
 * Echo a shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('echo', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;

  // User
  var user = request.user;
  if (!user) return response.error('User is not defined');

  // Object
  var shout = new Parse.Object('Shout');
  shout.id  = shoutId;

  // Echo
  shout.fetch().then(function(shout) {
    return user.get('info').fetch();
  }).then(function(info) {
    // Verify is user already echoed the shout
    var echoed = _.where(info.get('echoed'), {id: shout.id});

    if (!echoed.length) {
      // Info
      info.addUnique('echoed', shout);
      info.addUnique('following', shout);
      info.remove('removed', shout);

      // User
      user.set('feeling', shout.get('feeling'));

      // Shout
      shout.increment('echoes');
      shout.save(null, {useMasterKey: true});

      return Parse.Object.saveAll([user, info]);
    } else {
      return Parse.Promise.error('User cannot echo a shout twice');
    }
  }).then(function() {
    response.success(shout);
  }, response.error);
});

/**
 * Unecho a shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('unecho', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;

  // User
  var user = request.user;
  if (!user) return response.error('User is not defined');

  // Object
  var shout = new Parse.Object('Shout');
  shout.id  = shoutId;

  // Unecho
  shout.fetch().then(function(shout) {
    return user.get('info').fetch();
  }).then(function(info) {
    // Verify if user already echoed the shout
    var echoed    = _.where(info.get('echoed'), {id: shout.id});
    var commented = _.where(info.get('commented'), {id: shout.id});

    if (echoed.length) {
      shout.increment('echoes', -1);
      shout.save(null, {useMasterKey: true});

      info.remove('echoed', shout);

      // If user commented, there's still reason to keep following this shout
      if (!commented.length) {
        info.remove('following', shout);
      }

      return info.save();
    } else {
      return Parse.Promise.error('Cannot unecho a unechoed shout');
    }
  }).then(function() {
    response.success(shout);
  }, response.error);
});

/**
 * Follow a shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('follow', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;

  // User
  var user = request.user;
  if (!user) return response.error('User is not defined');

  // Object
  var shout = new Parse.Object('Shout');
  shout.id  = shoutId;

  // Follow
  shout.fetch().then(function(shout) {
    var info = user.get('info');

    info.remove('removed', shout);
    info.addUnique('following', shout);

    return info.save();
  }).then(function() {
    response.success(shout);
  }, response.error);
});

/**
 * Unfollow a shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('unfollow', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;

  // User
  var user = request.user;
  if (!user) return response.error('User is not defined');

  // Object
  var shout = new Parse.Object('Shout');
  var info  = user.get('info');
  shout.id  = shoutId;

  info.remove('following', shout);

  info.save().then(function() {
    response.success(shout);
  }, response.error);
});

/**
 * Remove a shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('remove', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;

  // User
  var user = request.user;
  if (!user) return response.error('User is not defined');

  // Object
  var shout = new Parse.Object('Shout');
  shout.id  = shoutId;

  // Remove
  shout.fetch().then(function(shout) {
    // User is removing his own shout
    if (shout.get('user').id == user.id) {
      return shout.destroy();
    } else {
      var info = user.get('info');

      info.addUnique('removed', shout);
      info.remove('following', shout);

      return info.save();
    }
  }).then(function() {
    response.success(shout);
  }, response.error);
});

/**
 * Restore a removed shout
 *
 * @param {string} shoutId
 *
 * @response {Parse.Object} Shout object
 */
Parse.Cloud.define('restore', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;

  // User
  var user = request.user;
  if (!user) return response.error('User is not defined');

  // Object
  var shout = new Parse.Object('Shout');
  var info  = user.get('info');
  shout.id  = shoutId;

  // Restore
  info.remove('removed', shout);

  info.save().then(function() {
    response.success(shout);
  }, response.error);
});

/**
 * Propose a new place
 *
 * @param {string} placeName
 * @param {string} parentId
 * @param {Parse.GeoPoint} [location]
 *
 * @response {Parse.Object} Place object
 */
Parse.Cloud.define('proposePlace', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var placeName = request.params.placeName;
  var parentId  = request.params.parentId;
  var location  = request.params.location || request.user.get('location');

  // Place
  var place   = new Parse.Object('PlaceTemp');
  var parent  = new Parse.Object('Place');
  parent.id = parentId;

  place.set('name', placeName.charAt(0).toUpperCase() + placeName.slice(1));
  place.set('parent', parent);
  place.set('location', location);
  place.add('locations', location);
  place.increment('entries');

  place.save().then(response.success, response.error);
});

/**
 * Endorse a proposed place
 *
 * @param {string} placeId
 * @param {Parse.GeoPoint} [location]
 *
 * @response {Parse.Object} Place object
 */
Parse.Cloud.define('endorsePlace', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var placeId  = request.params.placeId;
  var location = request.params.location || request.user.get('location');

  // Place
  var place = new Parse.Object('PlaceTemp');
  place.id  = placeId;

  place.fetch().then(function() {
    place.increment('entries');
    place.add('location', location);

    // Set location by average
    var locations = place.get('locations');
    var lats  = _.map(locations, function(point) { return point.latitude });
    var longs = _.map(locations, function(point) { return point.longitude });
    var sum   = function(memo, num) { return memo + num };
    location  = new Parse.GeoPoint();

    location.latitude  = _.reduce(lats, sum) / lats.length;
    location.longitude = _.reduce(longs, sum) / longs.length;

    place.set('location', location);

    return place.save();
  }).then(response.success, response.error);
});