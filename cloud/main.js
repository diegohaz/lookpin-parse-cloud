var User = require('cloud/User');
var Place = require('cloud/Place');
var Shout = require('cloud/Shout');

Parse.Cloud.define('delete', function(request, response) {
  var shout = new Shout;
  shout.id = request.params.shoutId;

  request.user.delete(shout).then(response.success, response.error);
});

Parse.Cloud.define('restore', function(request, response) {
  var shout = new Shout;
  shout.id = request.params.shoutId;

  request.user.restore(shout).then(response.success, response.error);
});

Parse.Cloud.define('flag', function(request, response) {
  var shout = new Shout;
  shout.id = request.params.shoutId;
  shout.flag().then(response.success, response.error);
});

Parse.Cloud.define('listShouts', function(request, response) {
  var user = request.user;
  var location = request.params.location || user.get('location');
  var place = request.params.place;
  var limit = request.params.limit;
  var page = request.params.page;

  Shout.list(location, place, limit, page).then(response.success, response.error);
});

Parse.Cloud.define('savePlace', function(request, response) {
  var id = request.params.id;
  var name = request.params.name;
  var location = request.params.location;

  Place.savePlace(id, name, location).then(response.success, response.error);
});

Parse.Cloud.define('listPlaces', function(request, response) {
  var location = request.params.location || request.user.get('location');

  Place.list(location).then(response.success, response.error);
});

Parse.Cloud.beforeSave(User, function(request, response) {
  request.object.filter().then(response.success, response.error);
});

Parse.Cloud.beforeDelete(User, function(request, response) {
  request.object.wipe().then(response.success, response.error);
});

Parse.Cloud.beforeSave(Place, function(request, response) {
  request.object.filter().then(response.success, response.error);
});

Parse.Cloud.beforeDelete(Place, function(request, response) {
  request.object.wipe().then(response.success, response.error);
});

Parse.Cloud.beforeSave(Shout, function(request, response) {
  request.object.get('user') || request.object.set('user', request.user);
  request.object.filter().then(response.success, response.error);
});
