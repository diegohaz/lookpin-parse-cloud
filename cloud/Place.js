var Shout = require('cloud/Shout');
var urlify = require('cloud/library/urlify');
var moment = require('moment');
var _ = require('underscore');

var Place = Parse.Object.extend('Place', {

  filter: function() {
    var place   = this;
    var parent  = place.get('parent');

    // Validations
    if (!place.get('name')) return Parse.Promise.error('Empty name');

    // ACL
    if (place.isNew()) {
      var acl = new Parse.ACL();

      acl.setPublicReadAccess(true);
      acl.setPublicWriteAccess(false);

      place.setACL(acl);
    }

    // Defaults
    place.get('promoted') || place.set('promoted', false);
    place.get('verified') || place.set('verified', false);

    return Parse.Promise.as();
  },

  wipe: function() {
    Parse.Cloud.useMasterKey();

    var place = this;
    var parent = place.get('parent');
    var promise;

    var adept = function(object, parent) {
      var objects = new Parse.Query(object);
      var objectsToSave = [];
      var objectsToDestroy = [];

      objects.equalTo('place', place);

      return objects.each(function(object) {
        if (!parent && object.className == 'Shout') {
          objectsToDestroy.push(object);
        } else {
          object.set('place', parent);
          objectsToSave.push(object);
        }
      }).then(function() {
        if (objectsToDestroy.length) {
          return Parse.Object.destroyAll(objectsToDestroy);
        } else {
          return Parse.Object.saveAll(objectsToSave);
        }
      });
    };

    // Try to set objects place to place's parent
    if (parent) {
      promise = Parse.Object.fetchAllIfNeeded([parent]);
    } else {
      promise = Parse.Promise.as();
    }

    return promise.always(function() {
      return adept(Place, parent);
    }).then(function() {
      return adept(Parse.User, parent);
    }).then(function() {
      return adept(Shout, parent);
    });
  },

  distanceTo: function(location) {
    return this.get('location').kilometersTo(location) * 1000;
  },

}, {

  ignoreCategories: ['4f2a25ac4b909258e854f55f'],

  list: function(location) {
    Parse.Cloud.useMasterKey();

    return Parse.Cloud.httpRequest({
      url: 'https://api.foursquare.com/v2/venues/search',
      params: {
        client_id: 'PFONHVXBWDZR5BYCVURJ4JMHZRWW4JJP0JU3J5J4SMOG0LYQ',
        client_secret: 'GTJICOF3ZK0CA5ZX13Y4RZ3XGZ424ZNH40SFQ2OR0JSQ5YXO',
        ll: location.latitude + ',' + location.longitude,
        v: moment().format('YYYYMMDD')
      }
    }).then(function(response) {
      var data = response.data;

      if (response.status == 200) {
        var venues = data.response.venues;
        var places = [];

        for (var i = 0; i < venues.length; i++) {
          var venue = venues[i];
          var category = venue.categories[0];
          var place = {};

          if (!category) continue;

          place.id = venue.id;
          place.name = venue.name;
          place.location = new Parse.GeoPoint(venue.location.lat, venue.location.lng);

          if (!~Place.ignoreCategories.indexOf(category.id)) {
            places.push(place);
          }
        }

        return Place.saveNeighborhood(location).then(function(neighborhood) {
          places.unshift(neighborhood);

          return Parse.Promise.as(places);
        });
      } else {
        return Parse.Promise.as(response.status);
      }
    });
  },

  savePlace: function(id, name, location) {
    Parse.Cloud.useMasterKey();

    var query = new Parse.Query(Place);
    var venue = new Place;

    query.equalTo('placeId', id);
    return query.first().then(function(place) {
      if (place) {
        var date = new Date;
        var lastMonth = new Date(date.setHours(date.getHours() - 24 * 7))

        if (place.updatedAt < lastMonth) {
          venue.id = place.id;
        } else {
          return Parse.Promise.as(place);
        }
      }

      return Parse.Promise.error();
    }).fail(function() {
      venue.set('placeId', id);
      venue.set('name', name);
      venue.set('location', location);

      return Place.saveNeighborhood(location).then(function(neighborhood) {
        venue.set('parent', neighborhood);

        return venue.save();
      });
    });
  },

  saveNeighborhood: function(location) {
    Parse.Cloud.useMasterKey();

    var types = ['country', 'administrative_area_level_1', 'locality', 'neighborhood'];
    var places = [];

    // Call Google Geocode API
    return Parse.Cloud.httpRequest({
      url: 'https://maps.googleapis.com/maps/api/geocode/json',
      params: {
        latlng: location.latitude + ',' + location.longitude,
        key: 'AIzaSyAFnlqLMFUeDJo-sRRTED7h-oyDcw3F3GM',
        components: types.join('|')
      }
    }).then(function(httpResponse) {
      var data = httpResponse.data;

      if (data.status == 'OK') {
        var results = data.results.reverse();
        var promises = [];
        var parent = null;

        for (var i = 0; i < types.length; i++) {
          var type = types[i];

          for (var j = 0; j < results.length; j++) {
            var result = results[j];

            if (~result.types.indexOf(type)) {
              var place = new Place;
              var location = result.geometry.location;
              var query = new Parse.Query(Place);

              place.set('placeId', result.place_id);
              place.set('name', result.address_components[0].long_name.replace('State of ', ''));
              place.set('location', new Parse.GeoPoint(location.lat, location.lng));
              place.set('parent', parent);

              query.equalTo('placeId', result.place_id);

              promises.push(query.first());
              places.push(place);

              parent = place;
            }
          }
        }

        return Parse.Promise.when(promises);
      } else {
        return Parse.Promise.error(data.status);
      }
    }).then(function() {
      _.each(arguments, function(place, i) {
        if (place) {
          var nextPlace = places[i + 1];

          if (nextPlace) {
            nextPlace.set('parent', place);
          }

          places[i] = place;
        }
      });

      return Parse.Object.saveAll(places);
    }).then(function(places) {
      return Parse.Promise.as(places[places.length - 1]);
    });
  },

  setTrends: function() {
    Parse.Cloud.useMasterKey();

    var placesToSave = [];

    // Clear places
    var places = new Parse.Query(Place);

    places.exists('shouts');
    return places.each(function(place) {
      place.unset('shouts');
      place.save();
    }).always(function() {
      // Trending
      var date = new Date();
      var yesterday = new Date(date.setDate(date.getDate() - 1));
      var shouts = new Parse.Query(Shout);

      shouts.greaterThan('createdAt', yesterday);
      shouts.include('place');

      return shouts.each(function(shout) {
        var place = shout.get('place');

        if (!~place.get('types').indexOf('establishment')) {
          return;
        }

        var matches = _.where(placesToSave, {id: place.id});

        if (matches.length) {
          place = matches[0];
        } else {
          place.feelings = {};
          place.feelings.red = 0;
          place.feelings.green = 0;
          place.feelings.blue = 0;
          place.feelings.black = 0;
          placesToSave.push(place);
        }

        place.feelings[shout.get('feeling')]++;

        var flngs = place.feelings;
        var max = Math.max(flngs.red, flngs.green, flngs.blue, flngs.black);
        for (var feeling in flngs) if (flngs[feeling] == max) break;

        place.set('feeling', feeling);
        place.increment('shouts');
      });
    }).always(function() {
      return Parse.Object.saveAll(placesToSave);
    }).then(function() {
      return Parse.Promise.as();
    });
  }

});

module.exports = Place;