var _ = require('underscore');
var names = require('cloud/names.js');
var validations = require('cloud/validations');

var urlify = require('cloud/urlify').create({
  spaces: ' ',
  toLower: true,
  nonPrintable: '',
  trim: true
});


/**
 * Validate user and set defaults
 */
Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  var user      = request.object;
  var nickname  = user.get('nickname');
  var feeling   = user.get('feeling');

  // Defaults
  user.get('setup')     || user.set('setup', false);
  user.get('language')  || user.set('language', 'en');

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
 * After save user
 */
Parse.Cloud.afterSave(Parse.User, function(request) {
  var user = request.object;

  // Info
  if (!user.get('info')) {
    var info = new Parse.Object('UserInfo');

    info.setACL(new Parse.ACL(user));
    info.save().then(function(info) {
      user.set('info', info);
      user.save(null, {useMasterKey: true});
    });
  }
});

/**
 * After delete user
 */
Parse.Cloud.afterDelete(Parse.User, function(request) {
  Parse.Cloud.useMasterKey();

  // User
  var user = request.object;

  // Delete user info
  user.get('info') && user.get('info').destroy();

  // Delete shouts
  var shouts = new Parse.Query('Shout');
  shouts.equalTo('user', user);

  shouts.find().then(function(shouts) {
    var shoutsToDestroy = [];

    for (var i = 0; i < shouts.length; i++) {
      shoutsToDestroy.push(shouts[i]);
    }

    if (shoutsToDestroy.length) {
      Parse.Object.destroyAll(shoutsToDestroy);
    }
  });

  // Delete comments
  var comments = new Parse.Query('Comment');
  comments.equalTo('user', user);

  comments.find().then(function(comments) {
    var commentsToDestroy = [];

    for (var i = 0; i < comments.length; i++) {
      commentsToDestroy.push(comments[i]);
    }

    if (commentsToDestroy.length) {
      Parse.Object.destroyAll(commentsToDestroy);
    }
  });
});

/**
 * User info before save
 */
Parse.Cloud.beforeSave('UserInfo', function(request, response) {
  var info  = request.object;

  if (info.isNew()) {
    info.get('echoed')    || info.set('echoed', []);
    info.get('commented') || info.set('commented', []);
    info.get('removed')   || info.set('removed', []);
    info.get('following') || info.set('following', []);
  }

  response.success();
});

/**
 * Before save shout
 */
Parse.Cloud.beforeSave('Shout', function(request, response) {
  // Params
  var shout = request.object;
  var user = shout.get('user') || request.user;

  user.fetch().then(function() {
    if (validations.post(shout, user, response)) {
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
 * Comment a shout
 */
Parse.Cloud.beforeSave('Comment', function(request, response) {
  // Params
  var comment = request.object;
  var shout   = comment.get('shout');
  var user    = comment.get('user') || request.user;

  user.fetch().then(function() {
    return shout.fetch();
  }).then(function() {
    if (validations.post(comment, user, response)) {
      if (comment.isNew()) {
        var acl = new Parse.ACL(user);

        acl.setPublicReadAccess(true);
        comment.setACL(acl);
      }

      response.success();
    }
  }, response.error);
});

/**
 * After comment a shout
 */
Parse.Cloud.afterSave('Comment', function(request) {
  var comment = request.object;
  var shout   = comment.get('shout');
  var user    = comment.get('user');

  if (!comment.existed()) {
    shout.increment('comments');
    shout.save(null, {useMasterKey: true});

    user.fetch().then(function() {
      // Update user info
      var info = user.get('info');

      info.addUnique('commented', shout);
      info.addUnique('following', shout);
      info.remove('removed', shout);
      info.save(null, {useMasterKey: true});
    });
  }
});

/**
 * After delete comment
 */
Parse.Cloud.afterDelete('Comment', function(request) {
  var comment = request.object;

  comment.get('shout').fetch().then(function(shout) {
    shout.increment('comments', -1);
    shout.save(null, {useMasterKey: true});
  });
});

/**
 * Before save place
 */
Parse.Cloud.beforeSave('Place', function(request, response) {
  var place = request.object;
  var parent = place.get('parent');

  // Validations
  if (!place.get('name')) return response.error('Empty name');

  // ACL
  if (keyword.isNew()) {
    var acl = new Parse.ACL();

    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);

    place.setACL(acl);
  }

  // Defaults
  if (parent && !place.get('depth')) {
    return parent.fetch().then(function() {
      place.set('depth', parent.get('depth') + 1);

      response.success();
    }, response.success);
  } else {
    place.get('depth') || place.set('depth', 0);
    response.success();
  }
});

/**
 * After save place
 */
Parse.Cloud.afterSave('Place', function(request) {
  var place = request.object;

  if (!place.existed()) {
    var keyword = new Parse.Object('PlaceKeyword');
    keyword.set('place', place);
    keyword.set('keyword', place.get('name'));
    keyword.save(null, {useMasterKey: true});
  }
});

/**
 * Before save place keyword
 */
Parse.Cloud.beforeSave('PlaceKeyword', function(request, response) {
  var keyword = request.object;
  var place   = keyword.get('place') || keyword.get('placeTemp');

  if (!place) return response.error('Empty place');

  // ACL
  if (keyword.isNew()) {
    var acl = new Parse.ACL();

    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);

    keyword.setACL(acl);
  }

  if (!keyword.get('keyword') && place) {
    place.fetch().then(function() {
      keyword.set('keyword', urlify(place.get('name')));
      response.success();
    }, response.error);
  } else {
    keyword.set('keyword', urlify(keyword.get('keyword')));
    response.success();
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
    return user.get('info').fetch();
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

  user.get('info').fetch().then(function(info) {
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
      return user.get('info').fetch().then(function(info) {
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

  user.get('info').fetch().then(function(info) {
    // Restore
    info.remove('removed', shout);

    return info.save();
  }).then(function() {
    response.success(shout);
  }, response.error);
});