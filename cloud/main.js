var _ = require('underscore');
var names = require('cloud/names.js');
var functions = require('cloud/functions.js');
var validations = require('cloud/validations');

/**
 * Validate user and set defaults
 */
Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  var nickname  = request.object.get('nickname');
  var feeling   = request.object.get('feeling');

  // Invalid?
  if (!request.object.isValid()) {
    return response.error('Invalid object');
  }

  // Defaults
  request.object.get('setup')     || request.object.set('setup', false);
  request.object.get('language')  || request.object.set('language', 'en');

  // Validate nickname
  if (nickname && !validations.nickname(nickname)) {
    return response.error('Invalid nickname');
  }

  // Validate feeling
  if (feeling && !validations.feeling(feeling)) {
    return response.error('Invalid feeling');
  }

  response.success();
});

/**
 * User info before save
 */
Parse.Cloud.beforeSave('UserInfo', function(request, response) {
  var info  = request.object;
  var user  = request.user;

  if (info.isNew()) {
    info.setACL(new Parse.ACL(user));

    info.get('echoed')    || info.set('echoed', []);
    info.get('commented') || info.set('commented', []);
    info.get('removed')   || info.set('removed', []);
    info.get('following') || info.set('following', []);
  }

  response.success();
});

/**
 * User info after save
 */
Parse.Cloud.afterSave('UserInfo', function(request) {
  var info = request.object;
  var user = request.user;

  if (!info.existed()) {
    user.set('info', info);
    user.save();
  }
});

/**
 * Before save shout
 */
Parse.Cloud.beforeSave('Shout', function(request, response) {
  // Params
  var shout = request.object;
  var user = shout.get('user') || request.user;

  user.fetch().then(function() {
    // Definitions
    shout.get('user')       || shout.set('user', user);
    shout.get('nickname')   || shout.set('nickname', user.get('nickname'));
    shout.get('location')   || shout.set('location', user.get('location'));
    shout.get('place')      || shout.set('place', user.get('place'));
    shout.get('placeTemp')  || shout.set('placeTemp', user.get('placeTemp'));
    shout.get('feeling')    || shout.set('feeling', user.get('feeling'));

    // Place
    var place = shout.get('place') || shout.get('placeTemp');

    // Empty validations
    if (!shout.get('user'))     return response.error('Empty user');
    if (!shout.get('nickname')) return response.error('Empty nickname');
    if (!shout.get('location')) return response.error('Empty location');
    if (!shout.get('feeling'))  return response.error('Empty feeling');
    if (!shout.get('content'))  return response.error('Empty content');
    if (!place)                 return response.error('Empty place');

    // More validations
    if (!validations.nickname(user.get('nickname'))) {
      return response.error('Invalid nickname');
    }

    if (!validations.feeling(user.get('feeling'))) {
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
 * After save shout
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
  if (!validations.feeling(feeling)) {
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
 * Comment a shout
 *
 * @param {string} shoutId
 * @param {string} content
 *
 * @response {Parse.Object} Comment object
 */
Parse.Cloud.define('comment', function(request, response) {
  // Params
  var shoutId = request.params.shoutId;
  var content = request.params.content;
  var user    = request.user;

  // Empty validations
  if (!user)                  return response.error('Empty user');
  if (!user.get('nickname'))  return response.error('Empty nickname');
  if (!user.get('location'))  return response.error('Empty location');
  if (!user.get('place'))     return response.error('Empty place');
  if (!content)               return response.error('Empty content');

  // More validations
  if (!validations.nickname(user.get('nickname'))) {
    return response.error('Invalid nickname');
  }

  if (content.length > 255) {
    return response.error('Content should not be larger than 255 characters');
  }

  // Object
  var comment = new Parse.Object('Comment');
  var shout   = new Parse.Object('Shout');
  shout.id    = shoutId;

  user.get('place').fetch().then(function(place) {
    return shout.fetch();
  }).then(function(shout) {
    var acl = new Parse.ACL(user);

    acl.setPublicReadAccess(true);

    comment.setACL(acl);
    comment.set('shout', shout);
    comment.set('user', user);
    comment.set('nickname', user.get('nickname'));
    comment.set('location', user.get('location'));
    comment.set('place', user.get('place'));
    comment.set('content', content);

    return comment.save();
  }).then(function(comment) {
    shout.increment('comments');

    return shout.save(null, {useMasterKey: true});
  }).then(function() {
    return functions.getUserInfo(user);
  }).then(function(info) {
    // Update user info
    info.addUnique('commented', shout);
    info.addUnique('following', shout);
    info.remove('removed', shout);

    return info.save();
  }).then(function() {
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
    return functions.getUserInfo(user);
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
    return functions.getUserInfo(user);
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
    return functions.getUserInfo(user);
  }).then(function(info) {
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
  shout.id = shoutId;

  functions.getUserInfo(user).then(function(info) {
    // Unfollow
    info.remove('following', shout);

    return info.save();
  }).then(function() {
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
      return functions.getUserInfo(user).then(function(info) {
        info.addUnique('removed', shout);
        info.remove('following', shout);

        return info.save();
      });
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
  shout.id  = shoutId;

  functions.getUserInfo(user).then(function(info) {
    // Restore
    info.remove('removed', shout);

    return info.save();
  }).then(function() {
    response.success(shout);
  }, response.error);
});