var Shout = require('cloud/Shout');
var urlify = require('cloud/library/urlify');
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
    if (!place.get('radius') && place.get('types')) {
      for (type in Place.types) {
        if (place.is(type)) {
          place.set('radius', Place.types[type]);
        }
      }
    }

    if (place.dirty('parent')) {
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

    return promise.then(function() {
      return adept(Parse.User, parent);
    }).then(function() {
      return adept(Place, parent);
    }).then(function() {
      return adept(Shout, parent);
    });
  },

  is: function(type) {
    return ~this.get('types').indexOf(type);
  },

  contains: function(location) {
    return this.get('location').kilometersTo(location) * 1000 < this.get('radius');
  }

}, {

  types: {
    bus_station: 10,
    establishment: 30,
    art_gallery: 40,
    food: 40,
    subway_station: 50,
    movie_theater: 75,
    aquarium: 75,
    restaurant: 100,
    parking: 100,
    park: 100,
    zoo: 100,
    night_club: 150,
    museum: 150,
    church: 150,
    casino: 150,
    school: 200,
    city_hall: 200,
    hindu_temple: 200,
    hospital: 250,
    shopping_mall: 300,
    cemetery: 300,
    campground: 300,
    university: 500,
    amusement_park: 500,
    stadium: 750,
    airport: 1000,
  },

  get: function(location) {
    Parse.Cloud.useMasterKey();

    var place = new Parse.Query(Place);

    place.near('location', location);
    place.withinKilometers('location', location, 20000);
    place.include([
      'parent', 'parent.parent', 'parent.parent.parent',
      'parent.parent.parent.parent', 'parent.parent.parent.parent.parent',
      'parent.parent.parent.parent.parent.parent',
    ]);

    return place.first().then(function(place) {
      while (place && !place.contains(location)) {
        place = place.get('parent');
      }

      return Parse.Promise.as(place);
    }).then(function(place) {
      if (place && !place.is('political')) {
        return Parse.Promise.as(place);
      } else {
        return Place.getFromGoogle(location);
      }
    });
  },

  getFromGoogle: function(location) {
    var types = ['country', 'administrative_area_level_1', 'locality', 'neighborhood'];
    var saveGoogleResults = function(results, parent, i) {
      var j = i;

      while (results[j] && !~results[j].types.indexOf(types[i])) {
        j++;
      }

      if (results[j]) {
        return Place.saveGoogleResult(results[j], parent);
      } else {
        return Parse.Promise.as(parent);
      }
    };

    // Call Google Geocode API
    return Parse.Cloud.httpRequest({
      url: 'https://maps.googleapis.com/maps/api/geocode/json',
      params: {
        latlng: location.latitude + ',' + location.longitude,
        components: types.join('|')
      }
    }).then(function(httpResponse) {
      var data = httpResponse.data;

      if (data.status == 'OK') {
        var results = data.results.reverse();

        return Place.saveGoogleResult(results[0]).then(function(parent) {
          return saveGoogleResults(results, parent, 1);
        }).done(function(parent) {
          return saveGoogleResults(results, parent, 2);
        }).done(function(parent) {
          return saveGoogleResults(results, parent, 3);
        });
      } else {
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
          radius: 500,
          types: Object.keys(Place.types).join('|')
        }
      }).then(function(httpResponse) {
        var data = httpResponse.data;

        if (data.status == 'OK') {
          var contains = false;

          for (var i = 0; i < data.results.length; i++) {
            var result = data.results[i];
            var establishment = Place.parseGoogleResult(result);

            if (establishment.contains(location)) {
              contains = true;
              break;
            }
          }

          if (contains) {
            establishment.set('parent', place);
            return establishment.save(null, {useMasterKey: true});
          } else {
            return Parse.Promise.as(place);
          }
        } else {
          return Parse.Promise.as(place);
        }
      });
    });
  },

  saveGoogleResult: function(result, parent) {
    var place = new Parse.Query(Place);

    place.equalTo('place_id', result.place_id);

    return place.first().then(function(place) {
      if (place) {
        return Parse.Promise.as(place);
      } else {
        return Parse.Promise.error();
      }
    }).fail(function() {
      place = Place.parseGoogleResult(result);
      place.set('parent', parent);

      return place.save(null, {useMasterKey: true});
    });
  },

  parseGoogleResult: function(result) {
    var place = new Place;
    var geometry = result.geometry;
    var placeLocation = new Parse.GeoPoint(geometry.location.lat, geometry.location.lng);

    place.set('place_id', result.place_id);
    place.set('types', result.types);
    place.set('location', placeLocation);

    // Is Google Geocode API
    if ('address_components' in result) {
      var name = result.address_components[0].long_name.replace('State of ', '');
      var northeast = new Parse.GeoPoint(geometry.bounds.northeast.lat, geometry.bounds.northeast.lng);
      var southwest = new Parse.GeoPoint(geometry.bounds.southwest.lat, geometry.bounds.southwest.lng);

      place.set('radius', northeast.kilometersTo(southwest) * 1000 / 2);
      place.set('name', name);
    // Is Google Places API
    } else {
      place.set('name', result.name);

      // Radius
      for (type in Place.types) {
        if (place.is(type)) {
          place.set('radius', Place.types[type]);
        }
      }
    }

    return place;
  },

  list: function(location, limit) {
    // Params
    limit = limit || 20;

    if (!location) return Parse.Promise.error('Empty location');

    // Query
    var places = new Parse.Query(Place);

    places.near('location', location);
    places.limit(limit - 3);

    return places.find().then(function(places) {
      var regions = new Parse.Query(Place);

      regions.near('location', location);
      regions.limit(3);

      return regions.find().then(function(regions) {
        return Parse.Promise.as(_.union(places, regions));
      });
    });
  }

});

module.exports = Place;