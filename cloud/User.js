var Feeling = require('cloud/Feeling');
var Shout = require('cloud/Shout');
var Place = require('cloud/Place');

var User = Parse.Object.extend('_User', {

  filter: function() {
    var user = this;

    // Defaults
    user.get('ignoreLocation') || user.set('ignoreLocation', false);
    user.get('language') || user.set('language', 'en');

    // Vars
    var place = user.get('place');
    var feeling = user.get('feeling');
    var location = user.get('location');
    var accuracy = user.get('locationAccuracy');
    var ignore = user.get('ignoreLocation');

    // Validate feeling
    if (feeling && !Feeling.validate(feeling)) {
      return Parse.Promise.error('Invalid feeling');
    }

    // Place user
    if (location && user.dirty('location') && !ignore) {
      return Place.get(location, accuracy, true).then(function(place) {
        user.set('place', place);

        return Parse.Promise.as();
      });
    } else {
      return Parse.Promise.as();
    }
  },

  wipe: function() {
    Parse.Cloud.useMasterKey();

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

  trustedLocation: function() {
    return this.get('locationAccuracy') <= 65 && !this.get('ignoreLocation');
  }
});

module.exports = User;