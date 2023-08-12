const admin = require('firebase-admin');
var serviceAccount = require("../config/serviceAccount.json");
var firebaseDatabaseURL = require("../config/firebaseDatabaseURL.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: firebaseDatabaseURL.firebaseDatabaseURL
});

const db = admin.database();

module.exports = db;
