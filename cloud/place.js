var _ = require('underscore');
var urlify = require('cloud/urlify.js').create({
  spaces: ' ',
  toLower: true,
  nonPrintable: '',
  trim: true
});

/**
 * Before save place
 *
 * @param {Parse.Object} parent
 * @param {String} name
 */
Parse.Cloud.beforeSave('Place', function(request, response) {
  var place   = request.object;
  var parent  = place.get('parent');

  // Validations
  if (!place.get('name')) return response.error('Empty name');

  // ACL
  if (place.isNew()) {
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
    }, response.error);
  } else {
    place.get('depth') || place.set('depth', 0);
    response.success();
  }
});

/**
 * Create a place keyword after save a new place
 */
Parse.Cloud.afterSave('Place', function(request) {
  var place = request.object;

  if (!place.existed()) {
    var keyword = new Parse.Object('PlaceKeyword');
    keyword.set('place', place);
    keyword.set('keyword', place.get('name'));
    keyword.set('location', place.get('location'));
    keyword.save(null, {useMasterKey: true});
  } else {
    var keyword = new Parse.Query('PlaceKeyword');

    keyword.equalTo('place', place);
    keyword.find(function(keywords) {
      var keywordsToSave = [];

      for (var i = 0; i < keywords.length; i++) {
        keywords[i].set('location', place.get('location'));
        keywordsToSave.push(keywords[i]);
      }

      Parse.Object.saveAll(keywordsToSave);
    });
  }
});

/**
 * Before delete place
 */
Parse.Cloud.beforeDelete('Place', clearPlace);

/**
 * Before save PlaceTemp
 *
 * @param {String} name
 * @param {Parse.Object} parent
 * @param {Parse.GeoPoint} location
 */
Parse.Cloud.beforeSave('PlaceTemp', function(request, response) {
  var place     = request.object;
  var parent    = place.get('parent');
  var location  = place.get('location');

  // Empty validations
  if (!place.get('name')) return response.error('Empty name');
  if (!parent)            return response.error('Empty parent');
  if (!location)          return response.error('Empty location');

  // ACL
  var acl = new Parse.ACL();
  acl.setPublicWriteAccess(false);
  acl.setPublicReadAccess(true);
  place.setACL(acl);

  // Defaults
  place.get('entries')   || place.set('entries', 0);
  place.get('locations') || place.set('locations', []);
  place.get('promote')   || place.set('promote', false);

  // Map
  if (!place.get('map')) {
    var lat = location.latitude;
    var lng = location.longitude;
    var map = 'http://maps.google.com/maps/q=' + lat + ',' + lng;
    place.set('map', map);
  }

  // Depth
  if (!place.get('depth')) {
    parent.fetch().then(function(parent) {
      place.set('depth', parent.get('depth') + 1);

      response.success();
    }, response.error);
  } else {
    response.success();
  }
});

/**
 * Create a place keyword after save a new place temp
 */
Parse.Cloud.afterSave('PlaceTemp', function(request) {
  var place = request.object;

  if (!place.existed()) {
    var keyword = new Parse.Object('PlaceKeyword');

    keyword.set('placeTemp', place);
    keyword.set('keyword', place.get('name'));
    keyword.set('location', place.get('location'));
    keyword.save(null, {useMasterKey: true});
  } else {
    var keyword = new Parse.Query('PlaceKeyword');

    keyword.equalTo('placeTemp', place);
    keyword.find(function(keywords) {
      var keywordsToSave = [];

      for (var i = 0; i < keywords.length; i++) {
        keywords[i].set('location', place.get('location'));
        keywordsToSave.push(keywords[i]);
      }

      Parse.Object.saveAll(keywordsToSave);
    });
  }
});

/**
 * Before delete proposed place
 */
Parse.Cloud.beforeDelete('PlaceTemp', clearPlace);

/**
 * Before save place keyword
 *
 * @param {Parse.Object} [place|placeTemp]
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
 * Get place
 *
 * @param {Parse.GeoPoint} [location]
 *
 * @response {Parse.Object} Place
 */
Parse.Cloud.define('getPlace', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var location = request.params.location || request.user.get('location');

  // Query
  var place = new Parse.Query('Place');
      place.near('location', location);
      place.withinKilometers('location', location, 20000);
      place.include(['parent', 'parent.parent', 'parent.parent.parent']);

  place.first().then(function(place) {
    if (place) {
      while (place.get('depth') > 1
        &&  place.get('location').kilometersTo(location) > .3) {
        place = place.get('parent');
      }

      return Parse.Promise.as(place);
    } else {
      return Parse.Promise.error('Could not find place');
    }
  }).then(function(place) {
    var depth = place.get('depth');

    // If current place is city and current location is far
    if (depth === 1 && place.get('location').kilometersTo(location) > 10) {
      // Get current city from Google Maps API
      return Parse.Cloud.httpRequest({
        url: 'http://maps.googleapis.com/maps/api/geocode/json',
        params: { latlng: location.latitude + ',' + location.longitude },
        key: 'AIzaSyA3-zoMVbiQZA-vbbc0mRKWVq1mRvYd_nI'
      }).then(function(httpResponse) {
        var data = httpResponse.data;

        if (data.status == 'OK') {
          var results = data.results;

          for (var i = 0; i < results.length; i++) {
            var result = results[i];
            var types  = result.types;

            // Iterate until result is city
            if (~types.indexOf('administrative_area_level_2')) {
              return Parse.Promise.as(result);
            }
          }

          return Parse.Promise.error('Could not find city');
        } else {
          return Parse.Promise.error(data.status);
        }
      }).then(function(city) {
        var cityAddress = city.address_components;
        var cityName    = cityAddress[0].long_name.replace(' County', '');
        var cityCountry = cityAddress[cityAddress.length-1].long_name;
        var cityLocal   = city.geometry.location;
        var cityGeo     = new Parse.GeoPoint(cityLocal.lat, cityLocal.lng);

        // Same city
        if (place.get('name') == cityName) {
          return Parse.Promise.as(place);
        } else {
          // Verify if city exists
          var query = new Parse.Query('Place');
              query.near('location', cityGeo);
              query.equalTo('name', cityName);
              query.equalTo('depth', 1);

          return query.first().then(function(city) {
            if (city) {
              return Parse.Promise.as(city);
            } else {
              // Verift if country exists
              var query = new Parse.Query('Place');
                  query.equalTo('depth', 0);
                  query.equalTo('name', cityCountry);

              return query.first().then(function(country) {
                if (country) {
                  return Parse.Promise.as(country);
                } else {
                  country = new Parse.Object('Place');
                  country.set('name', cityCountry);

                  return country.save();
                }
              }).then(function(country) {
                city = new Parse.Object('Place');
                city.set('name', cityName);
                city.set('location', cityGeo);
                city.set('parent', country);

                return city.save();
              });
            }
          });
        }
      });
    } else {
      return Parse.Promise.as(place);
    }
  }).then(response.success, response.error);
});

/**
 * Get places
 *
 * @param {Parse.GeoPoint} byDistance
 * @param {string} [byName=false]
 * @param {bool} [includeTemp=false]
 * @param {int} [limit=30]
 *
 * @response {Parse.Object[]} List of place objects
 */
Parse.Cloud.define('getPlaces', function(request, response) {
  // Params
  var user      = request.user;
  var distance  = request.params.byDistance;
  var name      = request.params.byName;
  var temp      = request.params.includeTemp;
  var limit     = request.params.limit || 30;

  var keywords = new Parse.Query('PlaceKeyword');
  keywords.include('place');

  // By distance
  if (distance) {
    keywords.near('location', distance);
  }

  // includeTemp
  if (temp) {
    keywords.include('placeTemp');
  } else {
    keywords.doesNotExist('placeTemp');
  }

  // By name
  if (name) {
    name = urlify(name);
    keywords.contains('keyword', name);
  }

  keywords.find().then(function(keywords) {
    placesToReturn = [];

    for (var i = 0; i < keywords.length; i++) {
      var place = keywords[i].get('place') || keywords[i].get('placeTemp');

      // Return each place only once
      if (!_.where(placesToReturn, {id: place.id}).length && place.get('depth') > 1) {
        placesToReturn.push(place);
      }
    }

    response.success(placesToReturn);
  }, response.error);
});

/**
 * Propose a new place
 *
 * @param {string} placeName
 * @param {Parse.GeoPoint} [location]
 *
 * @response {Parse.Object} Place object
 */
Parse.Cloud.define('proposePlace', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var placeName = request.params.placeName;
  var location  = request.params.location || request.user.get('location');

  placeName  = placeName.charAt(0).toUpperCase() + placeName.slice(1);

  // Query
  var place = new Parse.Query('Place');
      place.near('location', location);
      place.equalTo('name', placeName);

  // Verify if it's place first
  place.first().then(function(place) {
    if (place && place.get('location').kilometersTo(location) < .3) {
      return Parse.Promise.as(place);
    } else {
      return Parse.Promise.error();
    }
  }).then(response.success, function() {
    place = new Parse.Query('PlaceTemp');
    place.near('location', location);
    place.equalTo('name', placeName);

    // Verify if it's placeTemp second
    return place.first();
  }).then(function(place) {
    // Verify if there's place with this name and this is near
    if (place && place.get('location').kilometersTo(location) < .3) {
      place.increment('entries');
      place.add('locations', location);

      // Set location by average
      var locations = place.get('locations');
      var lats  = _.map(locations, function(point) { return point.latitude });
      var longs = _.map(locations, function(point) { return point.longitude });
      var sum   = function(memo, num) { return memo + num };
      location  = new Parse.GeoPoint();

      location.latitude  = _.reduce(lats, sum) / lats.length;
      location.longitude = _.reduce(longs, sum) / longs.length;

      place.set('location', location);

      return place.save();
    } else {
      // If not, get the parent place and create the place
      var parent = new Parse.Query('Place');
          parent.near('location', location);
          parent.equalTo('depth', 1);

      return parent.first().then(function(parent) {
        if (parent) {
          place = new Parse.Object('PlaceTemp');
          place.set('name', placeName);
          place.set('parent', parent);
          place.set('location', location);
          place.add('locations', location);
          place.increment('entries');

          return place.save();
        } else {
          return Parse.Promise.error('Could not find parent place');
        }
      });
    }
  }).then(response.success, response.error);
});

/**
 * Seek temp places for promoting
 */
Parse.Cloud.job('promotePlace', function(request, status) {
  Parse.Cloud.useMasterKey();

  var temps = new Parse.Query('PlaceTemp');
  var tempsToDestroy = [];

  temps.equalTo('promote', true);
  temps.each(function(temp) {
    var place = new Parse.Object('Place');

    place.set('name', temp.get('name'));
    place.set('parent', temp.get('parent'));
    place.set('location', temp.get('location'));
    place.set('shouts', temp.get('shouts'));

    return place.save().then(function(place) {
      temp.set('parent', place);

      return temp.save();
    }).then(function(temp) {
      return temp.destroy();
    });
  }).then(function() {
    status.success();
  }, status.error);
});

/**
 * Clear place
 */
function clearPlace(request, response) {
  Parse.Cloud.useMasterKey();

  var place  = request.object;
  var object = place.className;
  var column = object.charAt(0).toLowerCase() + object.slice(1);

  // Delete keywords
  var keywords = new Parse.Query('PlaceKeyword');

  keywords.equalTo(column, place);
  keywords.find().then(function(results) {
    var keywordsToDelete = [];

    for (var i = 0; i < results.length; i++) {
      keywordsToDelete.push(results[i]);
    }

    if (keywordsToDelete.length) {
      Parse.Object.destroyAll(keywordsToDelete);
    }
  });

  // Try to set objects place to place's parent
  if (place.get('parent')) {
    place.get('parent').fetch().then(function(parent) {
      var promises = [];
      var performSave = function(object) {
        var objects = new Parse.Query(object);

        objects.equalTo(column, place);
        return objects.find().then(function(results) {
          var objectsToSave = [];

          for (var i = 0; i < results.length; i++) {
            results[i].unset('placeTemp');
            results[i].set('place', parent);
            objectsToSave.push(results[i]);
          }

          if (objectsToSave.length) {
            return Parse.Object.saveAll(objectsToSave);
          } else {
            return Parse.Promise.as();
          }
        });
      };

      promises.push(performSave(Parse.User));
      promises.push(performSave('Place'));
      promises.push(performSave('PlaceTemp'));
      promises.push(performSave('Shout'));
      promises.push(performSave('Comment'));

      Parse.Promise.when(promises).then(response.success, response.error);
    }, response.success);
  } else {
    response.success();
  }
}