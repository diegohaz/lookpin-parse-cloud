var names = require('cloud/names.js');

// Validate nickname
exports.nickname = function(nickname) {
  if (nickname.length <= 48) {
    return true;
  } else {
    return false;
  }
}

// Validate feeling
exports.feeling = function(feeling) {
  var feelings = Object.keys(names.adjectives['en']);

  if (~feelings.indexOf(feeling)) {
    return true;
  } else {
    return false;
  }
}

// Validate post
exports.post = function(post, user, response) {
  // Definitions
  post.get('user')       || post.set('user', user);
  post.get('nickname')   || post.set('nickname', user.get('nickname'));
  post.get('location')   || post.set('location', user.get('location'));
  post.get('place')      || post.set('place', user.get('place'));
  post.get('placeTemp')  || post.set('placeTemp', user.get('placeTemp'));
  post.get('feeling')    || post.set('feeling', user.get('feeling'));

  // Place
  var place = post.get('place') || post.get('placeTemp');

  // Empty validations
  if (!post.get('user'))     return !!response.error('Empty user');
  if (!post.get('nickname')) return !!response.error('Empty nickname');
  if (!post.get('location')) return !!response.error('Empty location');
  if (!post.get('feeling'))  return !!response.error('Empty feeling');
  if (!post.get('content'))  return !!response.error('Empty content');
  if (!place)                return !!response.error('Empty place');

  // More validations
  if (!exports.nickname(user.get('nickname'))) {
    return !!response.error('Invalid nickname');
  }

  if (!exports.feeling(user.get('feeling'))) {
    return !!response.error('Invalid feeling');
  }

  if (post.get('content').length > 255) {
    return !!response.error('Content should not be larger than 255 characters');
  }

  return true;
}