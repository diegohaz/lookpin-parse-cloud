var Feeling = require('cloud/Feeling');
var Shout = require('cloud/Shout');
var Place = require('cloud/Place');
var _ = require('underscore');

var User = Parse.Object.extend('_User', {

  filter: function() {
    var user = this;
    var place = user.get('place');
    var feeling = user.get('feeling');
    var location = user.get('location');
    var accuracy = user.get('locationAccuracy') || 20;

    // Validate feeling
    if (feeling && !Feeling.validate(feeling)) {
      return Parse.Promise.error('Invalid feeling');
    }

    if (!user.get('locationAccuracy')) {
      user.set('locationAccuracy', accuracy);
    }

    // Place user
    if (location && user.dirty('location') && !user.get('ignoreLocation')) {
      return Place.get(location, accuracy).then(function(place) {
        user.set('place', place);

        return Parse.Promise.as();
      });
    } else {
      return Parse.Promise.as();
    }
  },

  propagate: function() {
    var user = this;

    // Info
    if (!user.get('info')) {
      var info = new Parse.Object('UserInfo');

      info.set('echoes', []);
      info.set('deletes', []);
      info.setACL(new Parse.ACL(user));

      return info.save().then(function(info) {
        user.set('info', info);
        return user.save(null, {useMasterKey: true});
      });
    } else {
      return Parse.Promise.as();
    }
  },

  wipe: function() {
    Parse.Cloud.useMasterKey();

    // Delete user info
    this.get('info') && this.get('info').destroy();

    // Delete shouts
    var shouts = new Parse.Query(Shout);
    shouts.equalTo('user', this);

    return shouts.find().then(function(shouts) {
      var shoutsToDestroy = [];

      for (var i = 0; i < shouts.length; i++) {
        shoutsToDestroy.push(shouts[i]);
      }

      if (shoutsToDestroy.length) {
        return Parse.Object.destroyAll(shoutsToDestroy);
      } else {
        return Parse.Promise.as();
      }
    });
  },

  echo: function(shout) {
    var user = this;
    var info = user.get('info');

    return Parse.Object.fetchAllIfNeeded([shout, info]).then(function() {
      var echoed = _.where(info.get('echoes'), {id: shout.id});

      if (!echoed.length) {
        shout.echo();

        info.addUnique('echoes', shout);
        info.remove('deletes', shout);

        user.set('feeling', shout.get('feeling'));

        return Parse.Object.saveAll([user, info]);
      } else {
        return Parse.Promise.error('User cannot echo a shout twice');
      }
    });
  },

  unecho: function(shout) {
    var user = this;
    var info = user.get('info');

    return Parse.Object.fetchAllIfNeeded([shout, info]).then(function() {
      var echoed = _.where(info.get('echoed'), {id: shout.id});

      if (echoed.length) {
        shout.unecho();
        info.remove('echoes', shout);

        return info.save();
      } else {
        return Parse.Promise.error('Cannot unecho a unechoed shout');
      }
    });
  },

  delete: function(shout) {
    var user = this;
    var info = user.get('info');

    return Parse.Object.fetchAllIfNeeded([shout, info]).then(function() {
      if (shout.get('user').id == user.id) {
        return shout.destroy();
      } else {
        info.addUnique('deletes', shout);
        info.remove('echoes', shout);

        return info.save();
      }
    });
  },

  restore: function(shout) {
    var user = this;
    var info = user.get('info');

    info.remove('deletes', shout);

    return info.save();
  },

  canUseLocation: function() {
    return this.get('locationAccuracy') <= 30 && !this.get('ignoreLocation');
  }
});

module.exports = User;