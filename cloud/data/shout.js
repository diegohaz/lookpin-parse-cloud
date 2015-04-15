var _ = require('underscore');
var validate = require('cloud/modules/validate.js');

/**
 * Validate and set defaults to shout before save
 *
 * @param {String} content
 */
Parse.Cloud.beforeSave('Shout', function(request, response) {
  // Params
  var shout = request.object;
  var user = shout.get('user') || request.user;

  user.fetch().then(function() {
    if (validate.post(shout, user, response)) {
      if (shout.isNew()) {
        var acl = new Parse.ACL(user);

        acl.setPublicReadAccess(true);
        shout.setACL(acl);
      }

      response.success();
    }
  }, response.error);
});

/**
 * Increment place shouts after save a shout
 */
Parse.Cloud.afterSave('Shout', function(request) {
  var shout = request.object;
  var place = shout.get('place');

  if (!shout.existed() && place) {
    place.increment('shouts');
    place.save(null, {useMasterKey: true});
  }
});

/**
 * Delete shout references
 */
Parse.Cloud.afterDelete('Shout', function(request) {
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
      Parse.Object.saveAll(infosToSave);
    }
  });

  // Now, delete comments
  query = new Parse.Query('Comment');
  query.equalTo('shout', shout);

  query.find().then(function(comments) {
    var commentsToDestroy = [];

    for (var i = 0; i < comments.length; i++) {
      commentsToDestroy.push(comments[i]);
    }

    if (commentsToDestroy.length) {
      Parse.Object.destroyAll(commentsToDestroy);
    }
  });

  // Decrement shouts in place
  var place = shout.get('place');

  if (place) {
    place.fetch().then(function() {
      place.increment('shouts', -1);
      place.save();
    });
  }
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