const express = require('express');
const Motion3DCaptcha = require('./');
const app = express();

const captchaEngine = new Motion3DCaptcha();

const global = { sessions: {}}

app.get('/get-captcha', async (req, res) => {
    const { videoBuffer, solution } = await captchaEngine.generate();
    
    // Store solution in session/DB tied to a token
    const token = "unique_request_id";
    global.sessions[token] = solution; 

    res.set('Content-Type', 'video/webm');
    res.send(videoBuffer);
});

app.post('/verify', express.json(), (req, res) => {
    const { token, x, y, t } = req.body;
    const solution = global.sessions[token];

    const isValid = captchaEngine.validate({ x, y, t }, solution);
    res.json({ success: isValid });
});

app.listen(3000)