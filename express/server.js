const admin = require('firebase-admin');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const fsextra = require('fs-extra');
const { exec } = require('child_process');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const serviceAccount = require("../config/serviceAccount.json");
const firebaseDatabaseURL = require("../config/firebaseDatabaseURL.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: firebaseDatabaseURL.firebaseDatabaseURL
});

const { Storage } = require('@google-cloud/storage');
const storageClient = new Storage();
const db = admin.database();
const storage = admin.storage();

function serviceLog(message, userId) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [User ID: ${userId}] - ${message}\n`;
    fs.appendFileSync('log.txt', logMessage);
}

async function processSession(sessionKEY, downloadURL) {
    try {

        db.ref(`/statuses/${sessionKEY}`).set('Fetching');

        const audioFilePath = await downloadAudio(sessionKEY, downloadURL);
        console.log('Downloaded audio:', audioFilePath);

        db.ref(`/statuses/${sessionKEY}`).set('Processing');
        await runSpleeter(sessionKEY);
        console.log('Spleeter completed successfully');

        db.ref(`/statuses/${sessionKEY}`).set('Zipping');
        await zipAudio(sessionKEY);
        console.log('Zipped audio!');

        db.ref(`/statuses/${sessionKEY}`).set('Sending');
        const uploadedUrl = await uploadAudioStemsArchive(sessionKEY);
        console.log('Uploaded audio stems archive:', uploadedUrl);

        db.ref(`/statuses/${sessionKEY}`).set('download');
        db.ref(`/downloads/${sessionKEY}`).set(uploadedUrl)
        db.ref(`/uploads/${sessionKEY}`).remove();
    } catch (error) {
        console.error('Error processing session:', error);
        // Handle errors here
    }
}

    db.ref('/uploads').on('child_added', async snapshot => {
      const newupload = snapshot.val();
      const sessionKEY = snapshot.key;
      console.log(newupload,sessionKEY);
      processSession(sessionKEY, newupload);
    });

async function downloadAudio(sessionKEY, downloadURL) {
    try {
        const response = await fetch(downloadURL);
        const buffer = await response.buffer();

        const parsedURL = new URL(downloadURL);
        const pathNameSplit = parsedURL.pathname.split('/');
        const originalFileName = pathNameSplit[pathNameSplit.length - 1];

        const audioDir = `./audio/${sessionKEY}`;
        await fs.mkdir(audioDir, { recursive: true }); // Ensure the directory exists
        const audioFilePath = `${audioDir}/${sessionKEY}.mp3`;
        await fs.writeFile(audioFilePath, buffer);
        console.log(audioFilePath);
        return audioFilePath;
    } catch (error) {
        console.error('Error downloading audio:', error);
        throw error; // Re-throw the error for the caller to handle
    }
}

async function runSpleeter(sessionKEY) {
    return new Promise((resolve, reject) => {
        const spleetercmd = `spleeter separate ./audio/${sessionKEY}/${sessionKEY}.mp3 -p spleeter:5stems -o ./audio/${sessionKEY}/`;
        console.log(spleetercmd);
        exec(spleetercmd, async (error) => {
            if (error) {
                console.log(`Spleeter execution error: ${error}`);
                reject(error); // Reject the Promise if there is an error
                return;
            }
            resolve(true); // Resolve the Promise when Spleeter completes successfully
        });
    });
}

async function zipAudio(sessionKEY) {
    return new Promise((resolve, reject) => {
        const output = fsextra.createWriteStream(`./audio/${sessionKEY}.zip`);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.directory(`./audio/${sessionKEY}/${sessionKEY}`, false);
        archive.pipe(output);

        output.on('close', () => {
            resolve(true); // Resolve the Promise when the zip operation is complete.
        });

        output.on('error', (err) => {
            reject(err); // Reject the Promise if there is an error.
        });

        archive.finalize();
    });
}

async function uploadAudioStemsArchive(sessionKEY) {
    try {
        const bucket = storage.bucket('spleetee.appspot.com');
        const firebaseFilePath = `files/${sessionKEY}.zip`;
        await bucket.upload(`./audio/${sessionKEY}.zip`, {
            destination: firebaseFilePath
        });
        const file = bucket.file(firebaseFilePath);
        const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 1000 * 60 * 60 });
        return url;
    } catch (error) {
        console.error('Error uploading audio stems archive:', error);
        throw error; // Re-throw the error for the caller to handle
    }
}

