const url = require('url');
const jwt = require('jsonwebtoken');

const { User } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const ErrorResponse = require('../utils/errorResponse');
const transporter = require('../utils/mailTranspoter');

module.exports.register = asyncHandler(async (req, res) => {
  const { username, password, fullName, email } = req.body;

  const newUser = await User.build({ username, password, fullName, email });
  await newUser.validate();
  await newUser.encryptPassword();
  await newUser.save({ validate: false });

  const token = await newUser.generateAccessToken();
  const data = newUser.get({ plain: true });
  // remove password from response
  delete data.password;

  res.cookie('token', token, { httpOnly: true });

  res.status(201).json({
    status: 'success',
    data: data,
  });
});

module.exports.login = asyncHandler(async (req, res, next) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return next(new ErrorResponse('missing parameters', 400));
  }

  const user = await User.findOne({ where: { username } });
  if (!user) {
    return next(new ErrorResponse("username doesn't exist", 404));
  }

  const match = await user.comparePassword(password);
  if (!match) {
    return next(new ErrorResponse('password not match', 400));
  }

  const token = await user.generateAccessToken();
  const data = user.get({ plain: true });
  // remove password from response
  delete data.password;

  res.cookie('token', token, { httpOnly: true });

  res.status(200).json({
    status: 'success',
    data: data,
  });
});

module.exports.sendVerificationMail = asyncHandler(async (req, res, next) => {
  const { username, email, verified } = req.user;

  if (verified) {
    return next(new ErrorResponse('already verified', 400));
  }

  const user = await User.findOne({ where: { username } });
  const verificationToken = await user.generateVerificationToken();

  const verificationUrl = url.format({
    protocol: 'http',
    hostname: process.env.DOMAIN || 'localhost',
    port: process.env.DOMAIN ? undefined : process.env.PORT,
    pathname: '/api/v1/auth/verify',
    query: {
      token: verificationToken,
    },
  });

  const mailOptions = {
    from: process.env.MAIL_USER,
    to: email,
    subject: 'verification mail',
    text: verificationUrl,
  };

  res.status(200).json({
    status: 'success',
    data: 'send mail success',
  });

  transporter.sendMail(mailOptions, err => {
    if (err) console.log(err);
  });
});

module.exports.verifyVerificationMail = asyncHandler(async (req, res, next) => {
  const { token } = req.query;
  const secret = process.env.SECRET;

  if (!token) {
    return next(new ErrorResponse('token not found', 404));
  }

  jwt.verify(token, secret, async (err, decoded) => {
    if (err) return next(err);
    if (!decoded.verify) {
      return next(new ErrorResponse('invalid token', 400));
    }

    const user = await User.findOne({ where: { username: decoded.username } });

    if (user.verified) {
      return next(new ErrorResponse('already verified', 400));
    }

    await user.setDataValue('verified', true);
    await user.save();

    const newToken = await user.generateAccessToken();

    res.cookie('token', newToken, { httpOnly: true });

    res.status(200).json({
      status: 'success',
      data: {
        token: newToken,
      },
    });
  });
});

module.exports.sendForgotMail = asyncHandler(async (req, res, next) => {
  const { username } = req.query;
  if (!username) {
    return next(new ErrorResponse('missing parameters', 400));
  }

  const user = await User.findOne({ where: { username } });
  if (!user) {
    return next(new ErrorResponse("username doen't exist", 404));
  }

  if (!user.verified) {
    return next(new ErrorResponse("email hasn't been verified"), 400);
  }

  const code = Math.floor(Math.random() * 899999 + 100000).toString();
  const mailOptions = {
    from: process.env.MAIL_USER,
    to: user.email,
    subject: 'change password',
    text: 'your code: ' + code,
  };

  req.session.append(username, code);

  res.status(200).json({
    status: 'success',
    data: 'send mail success',
  });

  transporter.sendMail(mailOptions, err => {
    if (err) console.log(err);
  });
});

module.exports.resetPassword = asyncHandler(async (req, res, next) => {
  const { username, newPassword, forgotCode } = req.body;
  if (!username || !newPassword || !forgotCode) {
    return next(new ErrorResponse('missig parameters', 400));
  }

  const user = await User.findOne({ where: { username } });
  if (!user) {
    return next(new ErrorResponse("username doen't exist", 404));
  }

  if (forgotCode !== req.session.get(username)) {
    return next(new ErrorResponse('invalid forgot code', 400));
  }

  user.password = newPassword;
  await user.validate({ field: ['password'] });
  await user.encryptPassword();
  await user.save({ validate: false });

  req.session.remove(username);

  res.status(200).json({
    status: 'success',
    data: 'reset password success',
  });
});