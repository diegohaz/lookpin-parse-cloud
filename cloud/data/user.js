var validate = require('cloud/modules/validate.js');

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
  if (nickname && !validate.nickname(nickname)) {
    return response.error('Invalid nickname');
  }

  // Validate feeling
  if (feeling && !validate.feeling(feeling)) {
    return response.error('Invalid feeling');
  }

  response.success();
});

/**
 * Create user info object after save new user
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
 * Delete shouts and comments from user after delete him
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
 * Set defaults for UserInfo before save a new object
 */
Parse.Cloud.beforeSave('UserInfo', function(request, response) {
  var info = request.object;

  if (info.isNew()) {
    info.get('echoed')    || info.set('echoed', []);
    info.get('commented') || info.set('commented', []);
    info.get('removed')   || info.set('removed', []);
    info.get('following') || info.set('following', []);
  }

  response.success();
});