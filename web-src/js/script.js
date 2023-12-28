
var connection;
var testConnection;
const messageDelay = 40;

var signalRscript = "https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/6.0.1/signalr.js"

var canTranslate = false;


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function loadScript(scriptUrl) {
    const script = document.createElement('script');
    script.src = scriptUrl;
    document.body.appendChild(script);

    console.log("BILI READY!");

    removeBiliLivePlayer();

    return new Promise((res, rej) => {
        script.onload = function () {
            res();
        }
        script.onerror = function () {
            rej();
        }
    });
}

async function removeBiliLivePlayer() {
    console.log("attempting to turn off video..");

    //document.querySelectorAll("section").forEach(elem => { elem.remove(); });

    let t = typeof livePlayer;
    console.log(t);

    while (t == "undefined") {
        await sleep(60);
        t = typeof livePlayer;
        console.log(t);
    }
    livePlayer.volume(0);
    await sleep(200);
    livePlayer.stopPlayback()

    console.log("paused and muted video");

}

setTimeout(function () {
    loadScript(signalRscript)
        .then(() => {
            startStream();
        })
}, 1000);


function raiseBasicBiliEvent(node, event) {
    let rawHtml = node.outerHTML;

    var detail = {
        "listener": "bili-basic",
        "event": {
            "type": "chat",
            "html": rawHtml
        }
    }

    return detail;
}

//this event is raised when the app launches/changes url
function raiseUrlChangeEvent(url) {
    var detail = {
        "listener": "url-change",
        "event": {
            "type": "url-change",
            "url": url
        }
    }

    sendPayload(detail);
}

function checkDeletedNodes() {
    //If logged in, the deleted messages are not actually deleted but hidden
    let deletedNodes = document.querySelectorAll("[is-deleted]");
    if (deletedNodes.length) {
        //console.log(deletedNodes);
        for (let i = 0; i < deletedNodes.length; i++) {
            deletedNodes[i].remove();
        }
    }
}

function startStream() {
    const callback = async (mutationList, observer) => {               
        //console.log(mutationList);
        await sleep(messageDelay);
        for (let i = 0; i < mutationList.length; i++) {
            for (var j = 0; j < mutationList[i].addedNodes.length; j++) {
                processNode(mutationList[i].addedNodes[j]);
            }

            for (j = 0; j < mutationList[i].removedNodes.length; j++) {

                let node = mutationList[i].removedNodes[j];
                let uid = node.getAttribute('data-uid');
                let timestamp = node.getAttribute('data-ts');
                let ct = node.getAttribute('data-ct');

                var detail = {
                    "listener": "delete-message",
                    "event": {
                        uid: uid,
                        timestamp: timestamp,
                        ct: ct
                    }
                }
                sendPayload(detail);
            }
        }
    };

    const observer = new MutationObserver(callback);

    connection = new signalR.HubConnectionBuilder()
        .withUrl("http://localhost:6970/stream")
        .configureLogging(signalR.LogLevel.Information)
        .withAutomaticReconnect()
        .build();

    testConnection = connection;


    async function start() {
        try {
            await connection.start();
            console.log("SignalR Connected.");
        } catch (err) {
            console.log(err);
            setTimeout(start, 5000);
        }
    };

    connection.onclose(async () => {
        await start();
    });

    
    start().then(async() => {
        raiseUrlChangeEvent(window.location.href);
        let biliChatItem = document.querySelector("#chat-items");
        console.log(biliChatItem);
        let chatTrial = 0;
        let waitDuration = 100;
        let waitIncrease = 100;
        //getting the chat
        while (!biliChatItem && chatTrial < 50) {
            await sleep(waitDuration + waitIncrease * chatTrial);
            biliChatItem = document.querySelector("#chat-items");
            console.log('trial: ' + chatTrial++);
            console.log(biliChatItem);
        }
        if (biliChatItem) {
            observer.observe(biliChatItem, { subtree: false, childList: true });
        }
        else {
            console.log("Failed to get chat");
        }
    }) 

}

function processNode(node) {

    let detail;
    if (node.classList.contains('superChat-card-detail')) {
        //superchat
        detail = createSuperChatData(node);
    }
    else if (node.classList.contains('guard-buy')) {
        //sub
        detail = createGuardBuyData(node);
    }
    else if (node.classList.contains('gift-item')) {
        //gift
        detail = createGiftData(node);
    }
    else if (node.classList.contains('bulge-emoticon')) {
        //big sticker
        detail = createChatEmoticonData(node, true);
    }
    else if (node.classList.contains('chat-emoticon')) {
        //big sticker
        detail = createChatEmoticonData(node);
    }
    else if (node.classList.contains('danmaku-item')) {
        //regular chat
        detail = createChatMessageData(node);
    }

    //important-prompt-item
    //misc-msg room-silent
    //convention-msg

    if (detail) {
        sendPayload(detail);
    }

    let detailBasic;
    detailBasic = raiseBasicBiliEvent(node, "message");
    sendPayload(detailBasic);
    return;

}

//NOT ENOUGH SAMPLE
function createGuardBuyData(node) {
    let username = node.querySelector('span').innerHTML;
    let data =
    {
        listener: "guard",
        event:
        {
            username: username
        }
    };
    console.log(data);
    return data;
}

function createChatMessageData(node) {
    let uid = node.getAttribute('data-uid');
    let timestamp = node.getAttribute('data-ts');
    let ct = node.getAttribute('data-ct');
    let username = node.getAttribute('data-uname');
    let message = node.querySelector('.danmaku-item-right').innerHTML;
    let renderedText = node.getAttribute('data-danmaku');
    let backgroundColor = node.style.backgroundColor;

    let tags = getNodeTags(node);

    let data =
    {
        listener: "message",
        event:
        {
            uid: uid,
            timestamp: timestamp,
            ct: ct,
            username: username,
            message: message,
            renderedText: renderedText,
            backgroundColor: backgroundColor,

            tags: tags
        }
    };

    getTranslationData(renderedText, username, uid, ct, timestamp);

    console.log(data);
    return data;
}


function createChatEmoticonData(node, isBulge=false) {
    let uid = node.getAttribute('data-uid');
    let timestamp = node.getAttribute('data-ts');
    let ct = node.getAttribute('data-ct');
    let username = node.getAttribute('data-uname');
    let image = node.getAttribute('data-image');


    let tags = getNodeTags(node);

    let data =
    {
        listener: "emoticon",
        event:
        {
            uid: uid,
            timestamp: timestamp,
            ct: ct,
            username: username,
            image: image,
            isBulge: isBulge,
            tags: tags
        }
    };

    console.log(data);
    return data;
}

function createGiftData(node) {
    let uid = node.getAttribute('data-uid');
    let username = node.getAttribute('data-uname');

    let giftName = node.querySelector('gift-name').innerHTML;
    let giftAmount = node.querySelector('gift-num').innerHTML.replace('x', '').trim();
    let giftImage = node.querySelector('gift-frame').style.backgroundImage;

    let tags = getNodeTags(node);


    let data =
    {
        listener: "gift",
        event:
        {
            uid: uid,
            username: username,
            giftName: giftName,
            giftAmount: giftAmount,
            giftImage: giftImage,
            tags: tags
        }
    };

    console.log(data);
    return data;
}

function createSuperChatData(node) {
    let username = node.getAttribute('data-uname');
    let uid = node.getAttribute('data-uid');
    let timestamp = node.getAttribute('data-ts');
    let ct = node.getAttribute('data-ct');
    let renderedText = node.getAttribute('data-danmaku');
    let message = node.querySelector('.input-contain .text').innerHTML;

    let backgroundColor = "";
    let backgroundNode = node.querySelector('card-item-middle-bottom');
    if (backgroundNode) {
        backgroundColor = backgroundNode.style.backgroundColor;
    }

    let amount = 0;
    let amountRaw = 0;
    let amountNode = node.querySelector('card-item-top-right');
    if (amountNode) {
        amountRaw = amountNode.innerHTML;
        amount = amountNode.innerHTML.replace('电池','');
    }


    let tags = getNodeTags(node);

    let data =
    {
        listener: "superchat",
        event:
        {
            uid: uid,
            timestamp: timestamp,
            ct: ct,
            username: username,
            message: message,
            renderedText: renderedText,
            backgroundColor: backgroundColor,
            amount: amount,
            amountRaw: amountRaw,

            tags: tags
        }
    };

    console.log(data);

    getTranslationData(renderedText, username, uid, ct, timestamp);

    return data;
}

function getNodeTags(node) {

    let isWealth = false;
    let wealthNode = node.querySelector('.wealth-medal');

    let wealthMedal = "";

    if (wealthNode) {
        isWealth = true;
        wealthMedal = wealthNode.src;
    }

    let isFans = false;
    let fanNode = node.querySelector('.fans-medal-content');

    let fansMedal = "";
    let fansTitle = "";
    let fansLevel = 0;
    let fansColor = "";

    if (fanNode) {
        isFans = true;
        if (node.querySelector('.medal-guard')) {
            let url = node.querySelector('.medal-guard').style.backgroundImage;
            fansMedal = url.replace('url("', '")');
        }
        fansTitle = node.querySelector('.fans-medal-content').innerHTML;
        fansLevel = node.querySelector('.fans-medal-level').innerHTML;
        fansColor = node.querySelector('.fans-medal-level').style.color;
    }

    let isAdmin = false;
    let adminIconNode = node.querySelector('.admin-icon');
    if (adminIconNode) isAdmin = true;

    let tags = {
        isWealth: isWealth,
        wealthMedal: wealthMedal,

        isFans: isFans,
        fansMedal: fansMedal,
        fansTitle: fansTitle,
        fansLevel: fansLevel,
        fansColor: fansColor,

        isAdmin: isAdmin
    }

    return tags;
}


function getTranslationData(text, username, uid, ct, ts) {
    if (!canTranslate) return;

    var obj = JSON.stringify({
        "listener": "request-translate",
        "text": text,
        "username": username,
        "uid": uid,
        "ct": ct,
        "ts": ts,
    })
    console.log(obj);
    window.chrome.webview.postMessage(obj);
}

function sendTranslationData(translatedText, sourceText, username, sourceLang, targetLang, uid, ct, ts,reason) {

    let data =
    {
        listener: "translate",
        event:
        {
            uid: uid,
            timestamp: ts,
            ct: ct,
            message: decodeURIComponent(translatedText),
            text: decodeURIComponent(translatedText),
            sourceText: sourceText,
            username: username,
            sourceLanguage: sourceLang,
            targetLang: targetLang,
            reason: reason
        }
    };
    console.log(data);
    sendPayload(data);
}


function sendTranslationStatus(status) {
    canTranslate = (status.toLowerCase() == "true");
}


function sendTranslationNotice(text) {
    console.log(text);
}


function sendPayload(detail) {
    if (!connection) return;
    connection.invoke("SendMessage", JSON.stringify(detail)).catch(function (err) {
        return console.error(err.toString())
    });
}

function sendTestPayload(detail) {
    testConnection.invoke("SendMessage", JSON.stringify(detail)).catch(function (err) {
        return console.error(err.toString());
    });
}