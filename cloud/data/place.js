var _ = require('underscore');
var urlify = require('cloud/modules/urlify.js').create({
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
    }, response.success);
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
    keyword.save(null, {useMasterKey: true});
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
    keyword.save(null, {useMasterKey: true});
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
 * Get places
 *
 * @param {Parse.GeoPoint} byDistance
 * @param {bool} [byRelevance=false]
 * @param {string} [byName=false]
 * @param {bool} [includeTemp=false]
 *
 * @response {Parse.Object[]} List of place objects
 */
Parse.Cloud.define('getPlaces', function(request, response) {
  // Params
  var user      = request.user;
  var distance  = request.params.byDistance;
  var relevance = request.params.byRelevance;
  var name      = request.params.byName;
  var temp      = request.params.includeTemp;

  // Query
  var places = new Parse.Query('Place');

  // By distance
  if (distance) {
    places.near('location', distance);
  }

  // By relevance
  if (relevance) {
    places.descending('shouts');
  }

  // By name
  if (name) {
    var keywords = new Parse.Query('PlaceKeyword');

    name = urlify(name);

    keywords.contains('keyword', name);
    keywords.include('place');
    keywords.matchesQuery('place', places);

    if (temp) {
      var tempKeywords = new Parse.Query('PlaceKeyword');
      tempKeywords.include('placeTemp');
      tempKeywords.matchesQuery('placeTemp', places);

      keywords = Parse.Query.or(keywords, tempKeywords);
    }

    keywords.find().then(function(keywords) {
      placesToReturn = [];

      for (var i = 0; i < keywords.length; i++) {
        var place = keywords[i].get('place') || keywords[i].get('placeTemp');
        placesToReturn.push(place);
      }

      response.success(placesToReturn);
    }, response.error);
  } else {
    places.find().then(response.success, response.error);
  }
});

/**
 * Propose a new place
 *
 * @param {string} placeName
 * @param {string} parentId
 * @param {Parse.GeoPoint} [location]
 *
 * @response {Parse.Object} Place object
 */
Parse.Cloud.define('proposePlace', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var placeName = request.params.placeName;
  var parentId  = request.params.parentId;
  var location  = request.params.location || request.user.get('location');

  // Place
  var place   = new Parse.Object('PlaceTemp');
  var parent  = new Parse.Object('Place');
  parent.id = parentId;

  place.set('name', placeName.charAt(0).toUpperCase() + placeName.slice(1));
  place.set('parent', parent);
  place.set('location', location);
  place.add('locations', location);
  place.increment('entries');

  place.save().then(response.success, response.error);
});

/**
 * Endorse a proposed place
 *
 * @param {string} placeId
 * @param {Parse.GeoPoint} [location]
 *
 * @response {Parse.Object} Place object
 */
Parse.Cloud.define('endorsePlace', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var placeId  = request.params.placeId;
  var location = request.params.location || request.user.get('location');

  // Place
  var place = new Parse.Object('PlaceTemp');
  place.id  = placeId;

  place.fetch().then(function() {
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
  }).then(response.success, response.error);
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
    promises.push(performSave('Shout'));
    promises.push(performSave('Comment'));
    promises.push(performSave('Place'));
    promises.push(performSave('PlaceTemp'));

    Parse.Promise.when(promises).then(response.success, response.error);
  });
}