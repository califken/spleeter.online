const archiver = require('archiver');
const { exec } = require('child_process');
const express = require('express');
const multer = require('multer');
const db = require('./firebaseAdmin.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const key = uuidv4();
    const newDirectoryPath = path.join(__dirname, 'uploads', key);

    if (!fs.existsSync(newDirectoryPath)) {
        fs.mkdirSync(newDirectoryPath);
    }

    const oldFilePath = path.join(__dirname, 'uploads', req.file.filename);
    const newFilePath = path.join(newDirectoryPath, req.file.filename);
    fs.renameSync(oldFilePath, newFilePath);

    const newJobRef = db.ref(`/jobs/${key}`);
    newJobRef.set({
        filename: req.file.filename,
        key: key
    }, error => {
        if (error) {
            return res.status(500).send('Error saving to Firebase.');
        }
        console.log(key);
        res.json({ key: key });
    });
});

const jobsRef = db.ref('/jobs');
let initialJobKeys = new Set();

jobsRef.once('value', snapshot => {
    snapshot.forEach(childSnapshot => {
        initialJobKeys.add(childSnapshot.key);
    });

    jobsRef.on('child_added', childSnapshot => {
        if (initialJobKeys.has(childSnapshot.key)) {
            return;
        }

        const jobData = childSnapshot.val();

        if (jobData && jobData.filename && !jobData.progress) {
            childSnapshot.ref.update({ progress: 'spleeting' });

            let spleetercommand = `spleeter separate uploads/${jobData.key}/${jobData.filename} -o uploads/${jobData.key}/output/`;
            console.log(spleetercommand);

            exec(spleetercommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error running spleeter: ${error}`);
                    childSnapshot.ref.update({ progress: 'error' });
                    return;
                }

                childSnapshot.ref.update({ progress: 'zipping' });

                const outputDir = path.join(__dirname, 'uploads', jobData.key, 'output');
                const archivePath = path.join(__dirname, 'archives', `${jobData.key}.zip`);
                const archive = archiver('zip', {
                    zlib: { level: 9 }
                });

                const output = fs.createWriteStream(archivePath);
                archive.pipe(output);
                archive.directory(outputDir, false);
                archive.finalize();

                output.on('close', () => {
                    console.log(`Archived to ${archivePath}`);
                    fs.rmSync(path.join(__dirname, 'uploads', jobData.key), { recursive: true });
                    childSnapshot.ref.update({ progress: 'complete' });
                });
            });
        }
    });
});

app.get('/download/:key', (req, res) => {
    const key = req.params.key;
    const archivePath = path.join(__dirname, 'archives', `${key}.zip`);

    if (fs.existsSync(archivePath)) {
        res.sendFile(archivePath);
    } else {
        res.status(404).send('File not found.');
    }
});

const angularDistFolder = path.join(__dirname, '../web/spleeter');
app.use(express.static(angularDistFolder));

app.get('*', (req, res) => {
    res.sendFile(path.join(angularDistFolder, 'index.html'));
});

const port = 80;
app.listen(port, () => console.log(`Server is listening on port ${port}`));
