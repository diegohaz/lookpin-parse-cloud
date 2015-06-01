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

    // Radius
    if (!place.get('radius') && place.get('types')) {
      for (type in Place.types) {
        if (place.is(type)) {
          place.set('radius', Place.types[type]);
        }
      }
    }

    // Map
    if (!place.get('map') || place.dirty('location')) {
      var lat = place.get('location').latitude;
      var lng = place.get('location').longitude;

      place.set('map', 'https://maps.google.com/maps?q=' + lat + ',' + lng);
    }

    // Depth
    if (place.dirty('parent') && parent) {
      return Parse.Object.fetchAllIfNeeded([parent]).then(function() {
        place.set('depth', parent.get('depth') + 1);

        return Parse.Promise.as();
      });
    } else {
      place.get('depth') || place.set('depth', 0);

      return Parse.Promise.as();
    }
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

  is: function(type) {
    return ~this.get('types').indexOf(type);
  },

  getRadius: function() {
    for (type in Place.types) {
      if (this.is(type)) {
        return Place.types[type];
      }
    }
  },

  distanceTo: function(location) {
    return this.get('location').kilometersTo(location) * 1000;
  },

  contains: function(location) {
    return this.distanceTo(location) < this.get('radius');
  }

}, {

  places: [],

  types: {
    airport: 500,
    stadium: 300,
    cemetery: 300,
    amusement_park: 250,
    university: 250,
    campground: 200,
    shopping_mall: 200,
    casino: 150,
    park: 150,
    zoo: 150,
    museum: 100,
    night_club: 100,
    school: 75,
    city_hall: 75,
    train_station: 75,
    subway_station: 50,
    grocery_or_supermarket: 40,
    aquarium: 40,
    restaurant: 40,
    movie_theater: 30,
    library: 30,
    food: 25,
    gym: 20,
    cafe: 10,
  },

  create: function(place_id, name, location, parent, radius, types) {
    var equalPlace = new Parse.Query(Place);

    // Seek for equal place_id
    equalPlace.equalTo('place_id', place_id);

    // Verify first in saved places
    for (var i = 0; i < Place.places.length; i++) {
      var place = Place.places[i];

      if (place.get('place_id') == place_id) {
        return Parse.Promise.as(place);
      }
    }

    // After, verify in data
    return equalPlace.first().then(function(equalPlace) {
      if (equalPlace) {
        Place.places.push(equalPlace);
        return Parse.Promise.as(equalPlace);
      } else {
        return Parse.Promise.error();
      }
    }).fail(function() {
      var replaces = [
        ['State of ', ''],
        ['MUNIC.', 'Municipal'],
        [/ ltda/i, ''],
        [/\*/, ''],
        [/\s*[\-|\(].+$/, ''],
        [/,.+$/, ''],
        [/col[e|é]gio estadual/i, 'C.E.'],
        [/escola municipal/i, 'E.M.'],
        [/escola estadual/i, 'E.E.'],
        [/\d+\.\d+\.\d+\.? /, ''],
      ];

      for (i in replaces) {
        name = name.replace(replaces[i][0], replaces[i][1]);
      }

      var place = new Place;

      place.set('place_id', place_id);
      place.set('name', name);
      place.set('location', location);
      place.set('parent', parent);
      place.set('types', types);
      place.set('radius', radius || place.getRadius());

      Place.places.push(place);

      return place.save(null, {useMasterKey: true});
    });
  },

  createFromGoogle: function(result, parent) {
    var location = result.geometry.location;
    var placeId = result.place_id;
    var name = result.name;
    var placeLocation = new Parse.GeoPoint(location.lat, location.lng);
    var radius;
    var types = result.types;

    // Is Google Geocode API
    if ('address_components' in result) {
      var ne = result.geometry.bounds.northeast;
      var sw = result.geometry.bounds.southwest;
      var nePoint = new Parse.GeoPoint(ne.lat, ne.lng);
      var swPoint = new Parse.GeoPoint(sw.lat, sw.lng);

      name = result.address_components[0].long_name;
      radius = nePoint.kilometersTo(swPoint) * 1000 / 2;
    }

    return Place.create(placeId, name, placeLocation, parent, radius, types);
  },

  get: function(location, accuracy) {
    Parse.Cloud.useMasterKey();

    var place = new Parse.Query(Place);

    place.near('location', location);
    place.withinKilometers('location', location, 100);
    place.include([
      'parent', 'parent.parent', 'parent.parent.parent',
      'parent.parent.parent.parent', 'parent.parent.parent.parent.parent',
      'parent.parent.parent.parent.parent.parent',
    ]);

    return place.first().then(function(place) {
      while (place && (!place.contains(location) || accuracy > place.get('radius'))) {
        place = place.get('parent');
      }

      return Parse.Promise.as(place);
    }).then(function(place) {
      if (place && !place.is('political')) {
        return Parse.Promise.as(place);
      } else {
        return Place.getFromGoogle(location, accuracy).fail(function(error) {
          return Parse.Promise.as(place);
        });
      }
    });
  },

  getFromGoogle: function(location, accuracy) {
    var types = ['country', 'administrative_area_level_1', 'locality', 'neighborhood'];
    var saveGoogleResults = function(results, parent, i) {
      var j = i;

      while (results[j] && !~results[j].types.indexOf(types[i])) {
        j++;
      }

      if (results[j]) {
        return Place.createFromGoogle(results[j], parent);
      } else {
        return Parse.Promise.as(parent);
      }
    };

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
        Parse.Analytics.track('Google', {'Geocode': data.status});

        return Place.createFromGoogle(results[0]).then(function(parent) {
          return saveGoogleResults(results, parent, 1);
        }).done(function(parent) {
          return saveGoogleResults(results, parent, 2);
        }).done(function(parent) {
          return saveGoogleResults(results, parent, 3);
        });
      } else {
        Parse.Analytics.track('Google', {'Geocode': data.status});
        return Parse.Promise.error(data.status);
      }
    }).then(function(place) {
      // Call Google Places API
      return Parse.Cloud.httpRequest({
        url: 'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        params: {
          location: location.latitude + ',' + location.longitude,
          key: 'AIzaSyAFnlqLMFUeDJo-sRRTED7h-oyDcw3F3GM',
          rankby: 'prominence',
          radius: 300,
          types: Object.keys(Place.types).join('|')
        }
      }).then(function(httpResponse) {
        var data = httpResponse.data;

        if (data.status == 'OK') {
          var places = [];
          Parse.Analytics.track('Google', {'Places': data.status});

          for (var i = 0; i < data.results.length && i < 20; i++) {
            var result = Place.createFromGoogle(data.results[i], place);

            places.push(result);
          }

          return Parse.Promise.when(places).then(function() {
            for (var i = 0; i < arguments.length; i++) {
              if (arguments[i].contains(location) && accuracy <= arguments[i].get('radius')) {
                return Parse.Promise.as(arguments[i]);
              }
            }

            return Parse.Promise.as(place);
          });
        } else {
          Parse.Analytics.track('Google', {'Places': data.status});
          return Parse.Promise.as(place);
        }
      });
    });
  },

  list: function(location, limit) {
    // Params
    limit = limit || 15;

    if (!location) return Parse.Promise.error('Empty location');

    // Query
    var places = new Parse.Query(Place);

    places.near('location', location);
    places.withinKilometers('location', location, 0.5);
    places.notEqualTo('types', 'political');
    places.limit(limit - 3);

    return places.find().then(function(places) {
      var regions = new Parse.Query(Place);

      regions.near('location', location);
      regions.equalTo('types', 'political');
      regions.notEqualTo('types', 'country');
      regions.notEqualTo('types', 'administrative_area_level_1');
      regions.limit(3);

      return regions.find().then(function(regions) {
        return Parse.Promise.as(_.union(places, regions));
      });
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