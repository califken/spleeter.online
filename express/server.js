const admin = require('firebase-admin');
const fetch = require('node-fetch');
const fs = require('fs-extra');
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




db.ref('/bundles').on('child_added', async snapshot => {
    const bundleData = snapshot.val();
    const userId = bundleData.uid;  // Assuming the userId is stored with this key
    let filedatajson = JSON.stringify(bundleData);
    serviceLog(`${filedatajson}`, userId);

    try {
        
        serviceLog('Downloading the audio file...', userId);
        const response = await fetch(bundleData.downloadURL);
        const buffer = await response.buffer();

        const parsedURL = new URL(bundleData.downloadURL);
        const pathNameSplit = parsedURL.pathname.split('/');
        const originalFileName = pathNameSplit[pathNameSplit.length - 1];
        const fileExtension = originalFileName.split('.').pop();
        
        

        const audioDir = `./audio/${bundleData.uuid}`;
        serviceLog('Saving file to local directory...', userId);
        await fs.ensureDir(audioDir);
        await fs.writeFile(`${audioDir}/${bundleData.uuid}.mp3`, buffer);

        serviceLog('Running spleeter...', userId);
        exec(`spleeter separate ${audioDir}/${bundleData.uuid}.mp3 -p spleeter:5stems -o ${audioDir}`, async (error) => {
            if (error) {
                serviceLog(`Spleeter execution error: ${error}`, userId);
                return;
            }

            serviceLog('Spleeter processing complete, archiving the results...', userId);
            const output = fs.createWriteStream(`./audio/${bundleData.uuid}.zip`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.directory(`${audioDir}`, false);
            archive.pipe(output);
            archive.finalize();

            
        output.on('close', async () => {
          serviceLog('Archive created, uploading to Firebase Storage...', userId);
          const bucket = storage.bucket('spleetee.appspot.com');

          // Updating the file path to include the user's UID
          const firebaseFilePath = `files/${bundleData.uid}/${bundleData.uuid}.zip`;

          await bucket.upload(`./audio/${bundleData.uuid}.zip`, {
              destination: firebaseFilePath
          });

          const file = bucket.file(firebaseFilePath);
          const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 1000 * 60 * 60 });
          serviceLog('Upload complete. Updating RTDB with download URL...', userId);
          await snapshot.ref.update({ Output: url, status: 'download' });
          db.ref(`${bundleData.sessionPath}/download`).set(url);
          db.ref(`${bundleData.sessionPath}/status`).set('download');
          serviceLog(`Deleting directory: ${audioDir}`, userId);
        //   await fs.remove(audioDir);
      });
        });

    } catch (error) {
        serviceLog(`An error occurred: ${error}`, userId);
    }
});


// db.ref('/files').on('child_added', async snapshot => {
//     const fileData = snapshot.val();
//     const userId = fileData.UserUID;  // Assuming the userId is stored with this key
//     let filedatajson = JSON.stringify(fileData);
//     serviceLog(`${filedatajson}`, userId);

//     if (fileData.Output) {
//         serviceLog('Output already exists. Skipping processing...', userId);
//         return;
//     }

//     try {
//         serviceLog('New file detected, updating status to processing...', userId);
//         snapshot.ref.update({ JobStatus: 'processing' });

//         serviceLog('Downloading the audio file...', userId);
//         const response = await fetch(fileData.FilePath);
//         const buffer = await response.buffer();

//         const parsedURL = new URL(fileData.FilePath);
//         const pathNameSplit = parsedURL.pathname.split('/');
//         const originalFileName = pathNameSplit[pathNameSplit.length - 1];
//         const fileExtension = originalFileName.split('.').pop();

//         const newUUID = uuidv4();
//         serviceLog(`Generated new UUID: ${newUUID}`, userId);

//         const newFileName = `${newUUID}.${fileExtension}`;
//         const audioDir = `./audio/${newUUID}`;

//         snapshot.ref.update({ UUIDFileName: newUUID });

//         serviceLog('Saving file to local directory...', userId);
//         await fs.ensureDir(audioDir);
//         await fs.writeFile(`${audioDir}/${newFileName}`, buffer);

//         serviceLog('Running spleeter...', userId);
//         exec(`spleeter separate ${audioDir}/${newFileName} -p spleeter:5stems -o ${audioDir}`, async (error) => {
//             if (error) {
//                 serviceLog(`Spleeter execution error: ${error}`, userId);
//                 return;
//             }

//             serviceLog('Spleeter processing complete, archiving the results...', userId);
//             const output = fs.createWriteStream(`./audio/${newUUID}/${newUUID}.zip`);
//             const archive = archiver('zip', { zlib: { level: 9 } });
//             archive.directory(`./audio/${newUUID}/${newUUID}`, false);
//             archive.pipe(output);
//             archive.finalize();

            
//         output.on('close', async () => {
//           serviceLog('Archive created, uploading to Firebase Storage...', userId);
//           const bucket = storage.bucket('spleetee.appspot.com');

//           // Updating the file path to include the user's UID
//           const firebaseFilePath = `files/${userId}/${newUUID}.zip`;

//           await bucket.upload(`${audioDir}/${newUUID}.zip`, {
//               destination: firebaseFilePath
//           });

//           const file = bucket.file(firebaseFilePath);
//           const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 1000 * 60 * 60 });
//           serviceLog('Upload complete. Updating RTDB with download URL...', userId);
//           await snapshot.ref.update({ Output: url, JobStatus: 'complete' });

//           serviceLog(`Deleting directory: ${audioDir}`, userId);
//           await fs.remove(audioDir);
//       });
//         });

//     } catch (error) {
//         serviceLog(`An error occurred: ${error}`, userId);
//     }
// });
