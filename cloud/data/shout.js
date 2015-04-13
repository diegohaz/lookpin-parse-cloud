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