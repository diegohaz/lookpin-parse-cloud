var _ = require('underscore');
var util = require('cloud/util.js');

/**
 * Validate and set defaults to shout before save
 *
 * @param {String} content
 */
Parse.Cloud.beforeSave('Shout', function(request, response) {
  // Params
  var shout = request.object;
  var user  = shout.get('user') || request.user;

  user.fetch().then(function() {
    // Definitions
    shout.get('user')     || shout.set('user', user);
    shout.get('location') || shout.set('location', user.get('location'));
    shout.get('place')    || shout.set('place', user.get('place'));
    shout.get('feeling')  || shout.set('feeling', user.get('feeling'));
    shout.get('echoes')   || shout.set('echoes', 0);

    if (!shout.get('placeTemp') && user.get('placeTemp')) {
      shout.set('placeTemp', user.get('placeTemp'));
    }

    // Place
    var place = shout.get('place') || shout.get('placeTemp');

    // Empty validations
    if (!shout.get('user'))     return response.error('Empty user');
    if (!shout.get('location')) return response.error('Empty location');
    if (!shout.get('feeling'))  return response.error('Empty feeling');
    if (!shout.get('content'))  return response.error('Empty content');
    if (!place)                 return response.error('Empty place');

    if (!util.validateFeeling(user.get('feeling'))) {
      return response.error('Invalid feeling');
    }

    if (shout.get('content').length > 255) {
      return response.error('Content should not be larger than 255 characters');
    }

    if (shout.isNew()) {
      var acl = new Parse.ACL(user);

      acl.setPublicReadAccess(true);
      shout.setACL(acl);
    }

    response.success();
  }, response.error);
});

/**
 * Delete shout references
 */
Parse.Cloud.beforeDelete('Shout', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Object
  var shout = request.object;

  // Seek users which have references to shout
  var wasEchoed = new Parse.Query('UserInfo');
  wasEchoed.equalTo('echoed', shout);

  var wasCommented = new Parse.Query('UserInfo');
  wasCommented.equalTo('commented', shout);

  var wasRemoved = new Parse.Query('UserInfo');
  wasRemoved.equalTo('removed', shout);

  var wasFollowed = new Parse.Query('UserInfo');
  wasFollowed.equalTo('following', shout);

  // Finally, query
  var query = Parse.Query.or(wasEchoed, wasCommented, wasRemoved, wasFollowed);

  query.find().then(function(infos) {
    var infosToSave = [];

    for (var i = 0; i < infos.length; i++) {
      var info = infos[i];

      info.remove('echoed', shout);
      info.remove('commented', shout);
      info.remove('removed', shout);
      info.remove('following', shout);

      infosToSave.push(info);
    }

    if (infosToSave.length) {
      return Parse.Object.saveAll(infosToSave);
    } else {
      return Parse.Promise.as();
    }
  }).then(function() {
    response.success();
  }, response.error);
});

/**
 * Get shouts
 *
 * @param {Parse.GeoPoint} [location]
 * @param {int} [limit=30]
 * @param {int} [page=0]
 *
 * @response {Parse.Object[]} List of shout objects
 */
Parse.Cloud.define('getShouts', function(request, response) {
  // Params
  var user     = request.user;
  var location = request.params.location || user.get('location');
  var limit    = request.params.limit    || 30;
  var page     = request.params.page     || 0;

  if (!location) return response.error('Empty location');

  // Query
  var shouts = new Parse.Query('Shout');
  var now    = Date.now();

  shouts.near('location', location);
  shouts.withinKilometers('location', location, 20000);

  // Include 4 levels of places depth
  shouts.include([
    'place', 'placeTemp',
    'place.parent', 'placeTemp.parent',
    'place.parent.parent', 'placeTemp.parent.parent',
    'place.parent.parent.parent', 'placeTemp.parent.parent.parent',
  ]);
  shouts.limit(limit);
  shouts.skip(limit * page);

  shouts.find().then(function(shouts) {
    var ranks = [];

    for (var i = 0; i < shouts.length; i++) {
      var shout   = shouts[i];
      var place   = shout.get('place') || shout.get('placeTemp');
      var depth   = place.get('depth');
      var parent  = place.get('parent');

      // Rank
      var echoes  = shout.get('echoes') || 0;
      var minutes = (now - shout.createdAt.getTime()) / 60000;
      var meters  = location.kilometersTo(shout.get('location')) * 1000;
      ranks[i]    = meters + minutes/20 - echoes;

      // Place
      if (meters > 20000) {
        // City depth level
        while (depth > 1) {
          depth = parent.get('depth');
          shout.attributes.place = parent;
          parent = parent.get('parent');
        }
      } else if (meters > 500) {
        // Place depth level
        while (depth > 2) {
          depth = parent.get('depth');
          shout.attributes.place = parent;
          parent = parent.get('parent');
        }
      } else if (meters > 100) {
        // Inner place depth level
        while (depth > 3) {
          depth = parent.get('depth');
          shout.attributes.place = parent;
          parent = parent.get('parent');
        }
      }

      // Don't return unnecessary places
      shout.attributes.place.attributes.parent = null
    }

    if (shouts.length) {
      var shouts = _.sortBy(shouts, function(shout, index) {
        return ranks[index];
      });
    }

    response.success(shouts);
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