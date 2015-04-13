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