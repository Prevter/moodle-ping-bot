const config = require('./config.json');
const { Telegraf } = require('telegraf')
const bot = new Telegraf(config.TOKEN)

// wrapper for http and https modules to get correct module depending on url
const get_http = (url) => {
    return url.startsWith('https') ? require('https') : require('http');
}

let last_message = {
    status: 'unknown',
    ping: 0,
    message_id: -1,
    last_time: 0
}

// syncronize last message with pinned message in channel
const syncronizeLastMessage = () => {
    // load last message from channel
    return new Promise((resolve, reject) => {
        bot.telegram.getChat(config.CHANNEL_ID).then((chat) => {
            // get pinned message
            if (chat.pinned_message) {
                // try to find status in message
                last_message.message_id = chat.pinned_message.message_id;
                last_message.last_time = chat.pinned_message.date;
                if (chat.pinned_message.text.includes(config.WorkingMessage)) {
                    last_message.status = 'online';
                }
                else if (chat.pinned_message.text.includes(config.SlowMessage)) {
                    last_message.status = 'slow';
                }
                else if (chat.pinned_message.text.includes(config.TechWorkMessage)) {
                    last_message.status = 'techwork';
                }
                else if (chat.pinned_message.text.includes(config.ErrorMessage)) {
                    last_message.status = 'error';
                }
                else if (chat.pinned_message.text.includes(config.DownMessage)) {
                    last_message.status = 'offline';
                }
                else if (chat.pinned_message.text.includes(config.SpecialErrorMessage)) {
                    last_message.status = 'special';
                }
                if (last_message.status !== 'unknown')
                    console.log(`Recovered last message: "${last_message.status}"`, "ID:", last_message.message_id, "Time:", last_message.last_time);
            }
            resolve();
        }).catch((error) => {
            console.log(error);
            reject(error);
        });
    });
}

// wrapper for sending message to channel. also pins message and deletes the `message pinned` notification
const send = async (msg, callback) => {
    bot.telegram.sendMessage(config.CHANNEL_ID, msg).then((message) => {
        callback(message.message_id);
        bot.telegram.pinChatMessage(config.CHANNEL_ID, message.message_id, { disable_notification: true })
            .then(() => {
                bot.telegram.deleteMessage(config.CHANNEL_ID, message.message_id + 1);
            });
    });
};

// get day or days depending on number (1 день, 2 дні, 5 днів)
const getDayOrDays = (days) => {
    if (days % 10 === 1 && days % 100 !== 11)
        return 'день';
    else if (days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20))
        return 'дні';
    else
        return 'днів';
}

// create string with passed time (1 день 2:30:15)
const calculatePassedTime = (timestamp1, timestamp2) => {
    let timePassed = timestamp2 - timestamp1;
    let seconds = Math.floor(timePassed % 60);
    let minutes = Math.floor(timePassed / 60) % 60;
    let hours = Math.floor(timePassed / 3600) % 24;
    let days = Math.floor(timePassed / 86400);
    let result = '';
    if (days > 0)
        result += `${days} ${getDayOrDays(days)} `;
    if (hours > 0 || result.length > 0)
        result += `${hours}:`;
    if (minutes > 0 || result.length > 0)
        result += `${minutes < 10 ? '0' : ''}${minutes}:`;
    else
        result += `${minutes}:`;
    result += `${seconds < 10 ? '0' : ''}${seconds}`;
    return result;
};

// builds message depending on status
const createMessage = (result) => {
    let pingMessage = config.PingMessage.replace('{0}', result.ping);
    let changedTimeMessage = config.TimeMessage.replace('{0}', new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' }));
    let timePassedMessage = config.PassedTime.replace('{0}', calculatePassedTime(last_message.last_time, Date.now() / 1000));
    switch (result.status) {
        case 'online':
            return `${config.WorkingMessage}\n${pingMessage}\n${changedTimeMessage}\n${timePassedMessage}`;
        case 'slow':
            return `${config.SlowMessage}\n${pingMessage}\n${changedTimeMessage}\n${timePassedMessage}`;
        case 'techwork':
            return `${config.TechWorkMessage}\n${pingMessage}\n${changedTimeMessage}\n${timePassedMessage}`;
        case 'error':
            return `${config.ErrorMessage}\n${pingMessage}\n${changedTimeMessage}\n${timePassedMessage}`;
        case 'offline':
            return `${config.DownMessage}\n${changedTimeMessage}\n${timePassedMessage}`;
        case 'special':
            var message = config.StatusCodeMessage.replace('{0}', result.statusCode + ' ' + result.statusMessage);
            return `${config.SpecialErrorMessage}\n${message}\n${pingMessage}\n${changedTimeMessage}\n${timePassedMessage}`;
    }
}

// triggered when status changed. decides whether to send new message or edit old one
const statusChanged = (result) => {
    // bot haven't sent any message yet
    if (last_message.message_id === -1) {
        last_message.status = result.status;
        last_message.ping = result.ping;
        last_message.last_time = Date.now() / 1000;
        send(createMessage(result), (message_id) => {
            last_message.message_id = message_id;
        });
    }
    else {
        if (last_message.status !== result.status) {
            // before changing status, edit old message to show how much time passed
            bot.telegram.editMessageText(config.CHANNEL_ID, last_message.message_id, null, createMessage(result));

            // then send new message
            last_message.status = result.status;
            last_message.ping = result.ping;
            last_message.last_time = Date.now() / 1000;
            send(createMessage(result), (message_id) => {
                last_message.message_id = message_id;
            });
        }
        else {
            // status didn't change, edit old message
            last_message.ping = result.ping;
            bot.telegram.editMessageText(config.CHANNEL_ID, last_message.message_id, null, createMessage(result));
        }
    }
}

const check = () => {
    return new Promise((resolve, reject) => {
        let start = Date.now();
        const request = get_http(config.WEBSITE_URL).get(config.WEBSITE_URL, {
            timeout: config.Timeout
        }, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data = data + chunk.toString();
            });

            response.on('end', () => {
                let time = Date.now() - start;
                let returnObject = {
                    status: 'online',
                    ping: time,
                    statusCode: response.statusCode
                };

                if (response.statusCode === 200 && data.includes(config.WorkingContent)) {
                    if (time > config.CriticalPing) {
                        returnObject.status = 'slow';
                    }
                }
                else if (data.includes(config.TechnicalWorksContent) || response.statusMessage === 'Moodle under maintenance') {
                    returnObject.status = 'techwork';
                }
                else {
                    switch (response.statusCode) {
                        case 200:
                            returnObject.status = 'error';
                            break;
                        default:
                            returnObject.status = 'special';
                            returnObject.statusMessage = response.statusMessage;
                            break;
                    }
                }

                resolve(returnObject);
            });
        });

        request.on('error', error => {
            resolve({
                status: 'offline',
                statusCode: -1,
                ping: 0
            });
        });
    });
};

// logs status to console
const logStatus = (result) => {
    switch (result.status) {
        case 'online':
            console.log(`\x1b[32mOnline\x1b[37m, Ping: ${result.ping} ms`);
            break;
        case 'offline':
            console.log(`\x1b[31mOffline\x1b[37m`);
            break;
        case 'slow':
            console.log(`\x1b[33mSlow\x1b[37m, Ping: ${result.ping} ms`);
            break;
        case 'error':
        case 'special':
            console.log(`\x1b[36mError\x1b[37m, \x1b[35mStatus:\x1b[37m \x1b[4m${result.statusCode}\x1b[0m, Ping: ${result.ping} ms`);
            break;
        case 'techwork':
            console.log(`\x1b[35mTechwork\x1b[37m, Ping: ${result.ping} ms`);
            break;
    }
}

// called when status changes to anything except online. 
// double checks status to make sure it's not a false alarm
const retry = (result) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            check().then((new_result) => {
                if (result.status === new_result.status) {
                    var average_time = (result.ping + new_result.ping) / 2;
                    result.ping = average_time;
                    logStatus(result);
                    statusChanged(result);
                }
                resolve();
            });
        }, config.RetryInterval);
    });
};

// start checking loop. if status is not online, retry after some time
const start = () => {
    check().then((result) => {
        if (result.status !== 'online' && result.status !== 'techwork') {
            retry(result).then(() => {
                setTimeout(start, config.CheckInterval);
            });
        } else {
            logStatus(result);
            statusChanged(result);
            setTimeout(start, config.CheckInterval);
        }
    });
}

bot.launch();
syncronizeLastMessage().then(() => start());

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));