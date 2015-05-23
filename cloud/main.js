var User = require('cloud/User');
var Place = require('cloud/Place');
var Shout = require('cloud/Shout');

Parse.Cloud.define('echo', function(request, response) {
  var shout = new Shout;
  shout.id = request.params.shoutId;

  request.user.echo(shout).then(response.success, response.error);
});

Parse.Cloud.define('unecho', function(request, response) {
  var shout = new Shout;
  shout.id = request.params.shoutId;

  request.user.unecho(shout).then(response.success, response.error);
});

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
  shout.flag(request.params.description).then(response.success, response.error);
});

Parse.Cloud.define('listShouts', function(request, response) {
  var location = request.params.location || request.user.get('location');
  var limit = request.params.limit;
  var page = request.params.page;

  Shout.list(location, limit, page).then(response.success, response.error);
});

Parse.Cloud.define('listPlaces', function(request, response) {
  var location = request.params.location || request.user.get('location');
  var limit = request.params.limit;

  Place.list(location, limit).then(response.success, response.error);
});

Parse.Cloud.beforeSave(User, function(request, response) {
  request.object.filter().then(response.success, response.error);
});

Parse.Cloud.afterSave(User, function(request, response) {
  request.object.propagate();
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

Parse.Cloud.beforeDelete(Shout, function(request, response) {
  request.object.wipe().then(response.success, response.error);
});
