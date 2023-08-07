var admin = require("firebase-admin");
var serviceAccount = require("../config/g.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://spleetee-default-rtdb.firebaseio.com"
});
const userRef = admin.database().ref('/so/serviceonline');
userRef.once('value').then(function(snapshot) {
        console.log(snapshot.val());
});

const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const archiver = require('archiver');
const upload = multer({ dest: 'uploads/' });
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="myFile" />
      <button type="submit">Upload</button>
    </form>
  `);
});

app.post('/upload', upload.single('myFile'), (req, res) => {
  const uploadedFilePath = req.file.path;
  const outputFilePath = 'output/' + req.file.filename;

  exec(`spleeter separate ${uploadedFilePath} -o ${outputFilePath}`, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      return;
    }

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

    // This is to catch any errors that may occur while archiving the file
    archive.on('error', function(err) {
      throw err;
    });

    // Set the archive name
    res.attachment('output.zip');

    // This pipes the archived data to the response object
    archive.pipe(res);

    archive.directory(outputFilePath, false);


    archive.finalize();
  });
});

const port = 80;

app.listen(port, () => console.log(`Server is listening on port ${port}`));