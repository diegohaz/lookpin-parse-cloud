// Get user info
exports.getUserInfo = function(user) {
  var query = new Parse.Query('UserInfo');
  var info = new Parse.Object('UserInfo');

  if (user.get('info')) {
    info = user.get('info');

    return info.fetch();
  } else {
    return Parse.Promise.as(info);
  }
}