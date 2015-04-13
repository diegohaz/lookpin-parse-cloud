var validate = require('cloud/modules/validate.js');

/**
 * Comment a shout
 *
 * @param {Parse.Object} shout
 * @param {String} content
 */
Parse.Cloud.beforeSave('Comment', function(request, response) {
  // Params
  var comment = request.object;
  var shout   = comment.get('shout');
  var user    = comment.get('user') || request.user;

  user.fetch().then(function() {
    return shout.fetch();
  }).then(function() {
    if (validate.post(comment, user, response)) {
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
 * If comment is new, increment shout's comments and add shout to the commented
 * and following lists of user's info
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
 * Decrement comments in shout and adjust commented list in user's info after
 * delete a comment
 */
Parse.Cloud.afterDelete('Comment', function(request) {
  Parse.Cloud.useMasterKey();

  var comment = request.object;
  var shout   = comment.get('shout');
  var user    = comment.get('user');

  // Decrement comments in shout
  shout.fetch().then(function(shout) {
    shout.increment('comments', -1);
    shout.save();
  });

  // Remove commented shout from user info if it remains no comment in shout
  var comments = new Parse.Query('Comment');

  comments.equalTo('user', user);
  comments.first().then(function(result) {
    if (!result) {
      return user.fetch();
    } else {
      return Parse.Promise.error();
    }
  }).then(function(user) {
    var info = user.get('info');

    info.remove('commented', shout);
    info.save();
  });
});