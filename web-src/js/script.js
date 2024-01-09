
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


function raiseBasicBiliEvent(node, event, isHistory = false) {
    let rawHtml = node.outerHTML;

    var detail = {
        "listener": "bili-basic",
        "event": {
            "type": "chat",
            "html": rawHtml,
            isHistory: isHistory
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

            let historyNodes = biliChatItem.childNodes;
            for (let i = 0; i < historyNodes.length; i++) {
                setTimeout(function () {
                    processNode(historyNodes[i], true);
                }, messageDelay * i);
            }
        }
        else {
            console.log("Failed to get chat");
        }
    }) 

}

function processNode(node, isHistory) {

    let detail;

    console.log(node);

    if (node.classList.contains('superChat-card-detail')) {
        //superchat
        console.log("SUPERCHAT!");
        detail = createSuperChatData(node, isHistory);
    }
    else if (node.classList.contains('guard-buy')) {
        //sub
        console.log("GUARD!");
        detail = createGuardBuyData(node, isHistory);
    }
    else if (node.classList.contains('gift-item')) {
        //gift
        console.log("GIFT!");
        detail = createGiftData(node, isHistory);
    }
    else if (node.classList.contains('bulge-emoticon')) {
        //big sticker
        detail = createChatEmoticonData(node, true, isHistory);
    }
    else if (node.classList.contains('chat-emoticon')) {
        //big sticker
        detail = createChatEmoticonData(node, false, isHistory);
    }
    else if (node.classList.contains('danmaku-item')) {
        //regular chat
        detail = createChatMessageData(node, isHistory);
    }

    //important-prompt-item
    //misc-msg room-silent
    //convention-msg

    if (detail) {
        sendPayload(detail);
    }

    let detailBasic;
    detailBasic = raiseBasicBiliEvent(node, "message", isHistory);
    sendPayload(detailBasic);
    return;

}

//NOT ENOUGH SAMPLE
function createGuardBuyData(node, isHistory = false) {
    let username = node.querySelector('span').innerHTML;
    let message = node.innerText;
    message = message.substring(username.length);

    let tier = "captain";
    let tierRaw = "舰长";
    let tierNumber = 1;

    if (message.includes("提督")) {
        tier = "admiral";
        tierRaw = "提督";
        tierNumber = 2;
    }
    else if (message.includes("总督")) {
        tier = "governor";
        tierRaw = "总督";
        tierNumber = 3;
    }


    let data =
    {
        listener: "guard",
        event:
        {
            username: username,
            tier: tier,
            tierRaw: tierRaw,
            tierNumber: tierNumber,
            isHistory: isHistory
        }
    };
    console.log(data);
    return data;
}


function createChatMessageData(node, isHistory = false) {
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

            tags: tags,
            isHistory: isHistory
        }
    };

    getTranslationData(renderedText, username, uid, ct, timestamp);

    console.log(data);
    return data;
}

function createChatEmoticonData(node, isBulge = false, isHistory = false) {
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
            tags: tags,
            isHistory: isHistory
        }
    };

    console.log(data);
    return data;
}



function createGiftData(node, isHistory = false) {
    let uid = node.getAttribute('data-uid');
    let username = node.getAttribute('data-uname');

    let giftName = node.querySelector('.gift-name').innerHTML;
    let giftAmount = node.querySelector('.gift-num').innerHTML.replace('x', '').trim();
    if (!giftAmount) giftAmount = 1;
    let giftImage = node.querySelector('.gift-frame').style.backgroundImage || window.getComputedStyle(giftFrame, false).backgroundImage;
    giftImage = giftImage.replace('url("', '').replace('")', '').replace("url('", '').replace("')", '');
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
            tags: tags,
            isHistory: isHistory
        }
    };

    console.log(data);
    return data;
}


function createSuperChatData(node, isHistory = false) {
    let username = node.getAttribute('data-uname');
    let uid = node.getAttribute('data-uid');
    let timestamp = node.getAttribute('data-ts');
    let ct = node.getAttribute('data-ct');
    let renderedText = node.getAttribute('data-danmaku');
    let message = node.querySelector('.input-contain .text').innerHTML;

    let backgroundColor = "";
    let backgroundNode = node.querySelector('.card-item-middle-bottom');
    if (backgroundNode) {
        backgroundColor = backgroundNode.style.backgroundColor;
    }

    let amount = 0;
    let amountRaw = 0;
    let amountNode = node.querySelector('.card-item-top-right');
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

            tags: tags,
            isHistory: isHistory
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
            fansMedal = url.replace('url("', '').replace('")', '').replace("url('", '').replace("')", '');
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


function testMessage(type = "test-message") {

    let node;
    if (type == "test-message") {
        node = createTestChatMessageNode();
    }
    else if (type.startsWith("test-superchat")) {
        node = createTestSuperchatNode();
    }
    else if (type == "test-sticker") {
        node = createTestChatEmoticonNode();
    }
    else if (type == "test-member-3") {
        node = createTestGuardBuyNode(3);
    }
    else if (type == "test-member-2") {
        node = createTestGuardBuyNode(2);
    }
    else if (type == "test-member" || type == "test-member-1") {
        node = createTestGuardBuyNode(1);
    }
    else if (type.startsWith("test-gift")) {
        node = createTestGiftNode();
    }
    if (!node) return;
    processNode(node);

}


let currTestId = 1;
const TEST_MESSAGE_PREFIX = "TSTMSG";
function getMessageId() {
    return TEST_MESSAGE_PREFIX + (currTestId++);
}


const RANDOM_USERS = [
    { username: '我是猫', uid: "testusercat", text: "我是猫喵喵!" },
    {
        username: '我是狗',
        uid: "testuserdog",
        text: `我是狗汪汪! Woof woof <span class="danmaku-item-right v-middle ts-dot-2 pointer emoticon"><img class="open-menu" src="http://i0.hdslb.com/bfs/live/e2589d086df0db8a7b5ca2b1273c02d31d4433d4.png@20h.webp" alt="[大笑]" onerror="this.classList.add('error')"><span class="open-menu">[大笑]</span></span>`,
        html: `我是狗汪汪! Woof woof [大笑]`,
        level: 10
    },
    {
        username: '我是狐狸',
        uid: "testuserfox",
        html: `我是狐狸 A-hee-ahee ha-hee! <span class="danmaku-item-right v-middle ts-dot-2 pointer emoticon"><img class="open-menu" src="http://i0.hdslb.com/bfs/live/e2589d086df0db8a7b5ca2b1273c02d31d4433d4.png@20h.webp" alt="[大笑]" onerror="this.classList.add('error')"><span class="open-menu">[大笑]</span></span>`,
        text: `我是狐狸 A-hee-ahee ha-hee! [大笑]`,
        level: 69
    },
    { username: '我是牛', uid: "testusercow", text: "我是牛哞哞!" },
    {
        username: '我是青蛙', uid: "testuserfrog",
        html: `我是青蛙呱呱呱呱 <span class="danmaku-item-right v-middle ts-dot-2 pointer emoticon"><img class="open-menu" src="http://i0.hdslb.com/bfs/live/e2589d086df0db8a7b5ca2b1273c02d31d4433d4.png@20h.webp" alt="[大笑]" onerror="this.classList.add('error')"><span class="open-menu">[大笑]</span></span>`,
        text: `我是青蛙呱呱呱呱 [大笑]`,
        level: 12
    },
    { username: '我是鸭子', uid: "testuserduck", text: "我是鸭子嘎嘎嘎" },
    { username: '零xX零零zero零零Xx零', uid: "testuserzero", text: "零零零零零零零零零零零零零零零" }
];
function getRandomUser() {
    if (RANDOM_USERS.length < 1) return "random_name";

    let idx = Math.floor(RANDOM_USERS.length * Math.random());
    return RANDOM_USERS[idx];
}


function getFansMedalElem(level) {
    if (!level) return "";

    let image = "https://storage.googleapis.com/cdn.chroneco.moe/yt-css/images/cat64.png";
    let fansMedalElem = `<div class="fans-medal-item-ctnr fans-medal-item-target dp-i-block p-relative v-middle"  title="UWU OWO"  data-anchor-id="ANCHORID"  data-room-id="ROOMID">
        <div class="fans-medal-item" style="border-color: #5d7b9e">
            <div class="fans-medal-label"  style = " background-image: -o-linear-gradient(45deg, #5d7b9e, #5d7b9e);  background-image: -moz-linear-gradient(45deg, #5d7b9e, #5d7b9e); background-image: -webkit-linear-gradient(45deg, #5d7b9e, #5d7b9e);  background-image: linear-gradient(45deg, #5d7b9e, #5d7b9e);">
                <i class="medal-deco  medal-guard       " style="background-image: url(${image});"></i>                
                <span class="fans-medal-content">BIG FAN</span>
                </div>
                <div class="fans-medal-level" style="color: #5d7b9e">${level}</div>
            </div > 
        </div>`

    return fansMedalElem;
}



function stringToNode(str) {
    let e = document.createElement("div");
    e.innerHTML = str.trim();
    return e.firstChild;
}

function createTestGuardBuyNode(tier = 1) {
    let days = 1 + Math.floor(Math.random() * 1000);
    let tierRaw = "舰长";
    if (tier == 2) tierRaw = '提督';
    else if (tier == 3) tierRaw = '总督';
    let  elem = `<div class="chat-item misc-msg guard-buy">
  <span style="color: rgba(0, 209, 241, 1)">${getRandomUser().username}</span>
  ABCDE的直播间开通了${tierRaw}，今天是TA陪伴主播的第${days}天
</div>`;
    return stringToNode(elem);
}


function createTestChatMessageNode() {
    let user = getRandomUser();

    let uid = user.uid;
    let timestamp = Date.now();
    let ct = getMessageId();
    let username = user.username;
    let text = user.text;
    let html = user.html||user.text;
    let level = user.level;

    let elem = `<div class="chat-item danmaku-item" data-uname="${username}"  data-type="0"  data-show_reply="true"  data-replymid="0"  data-uid="${uid}"  data-ts="${timestamp}"  data-ct="${ct}"  data-danmaku="${text}">
  <div class="danmaku-item-left">
      ${getFansMedalElem(level)}
    <div class="common-nickname-wrapper">
      <span class="user-name v-middle pointer open-menu">${username} : </span>
    </div>
  </div>
  <span class="danmaku-item-right v-middle pointer ts-dot-2 open-menu">${html}</span>
</div>
`;
    
    return stringToNode(elem);
}


function createTestSuperchatNode() {
    let user = getRandomUser();

    let uid = user.uid;
    let timestamp = Date.now();
    let ct = getMessageId();
    let username = user.username;
    let text = user.text;
    let level = user.level;
    let amount = 300;
    let html = user.html || user.text;

    let elem = `<div  class="chat-item danmaku-item superChat-card-detail"  data-uname="${username}"  data-uid="${uid}"  data-ts="${timestamp}"  data-ct="${ct}"  data-danmaku="${text}">
  <div class="card-item-top-right">${amount}电池</div>
  <div class="card-item-middle-top"    style="background-image: url(); border: 1px solid #2a60b2; background-color: #edf5ff; " >
    <div class="card-item-middle-top-right">
      <div class="superChat-base">
        ${getFansMedalElem(level)}
      </div>
      <div class="common-nickname-wrapper card-item-name">
        <span style="color: #e17aff">${username}</span>
      </div>
    </div>
  </div>
  <div class="card-item-middle-bottom" style="background-color: #2a60b2">
    <div class="input-contain">
      <span class="text">${html}</span>
    </div>
    <div class="bottom-background" style=""></div>
  </div>
</div>
`;

    
    return stringToNode(elem);
}


function createTestGiftNode() {
    let user = getRandomUser();

    let uid = user.uid;
    let timestamp = Date.now();
    let ct = getMessageId();
    let username = user.username;
    let text = user.text;
    let level = user.level;
    let image = "https://storage.googleapis.com/cdn.chroneco.moe/yt-css/images/cat64.png";
    let amount = 1 + Math.floor(Math.random() * 20);

    let elem = `<div class="chat-item gift-item" data-uname="${username}" data-uid="${uid}">
  ${getFansMedalElem(level)}
  <div class="common-nickname-wrapper" style="vertical-align: bottom">
    <span class="username v-bottom pointer">${username}</span>
  </div>
  <span class="action v-bottom">投喂</span><span class="gift-name v-bottom">cat</span>
  <div class="dp-i-block v-middle">
    <div  class="gift-frame" style="width: 40px; height: 40px; background-image:url('${image}'); background-size: contain;"></div>
  </div>
  <span class="gift-num v-bottom">x${amount} </span><span class="gift-count v-bottom"></span>
</div>
`;

    
    return stringToNode(elem);
}


function createTestChatEmoticonNode() {
    let user = getRandomUser();

    let uid = user.uid;
    let timestamp = Date.now();
    let ct = getMessageId();
    let username = user.username;
    let text = user.text;
    let level = user.level;
    let image = "https://storage.googleapis.com/cdn.chroneco.moe/yt-css/images/cat64.png";


    let elem = `<div class="chat-item danmaku-item chat-emoticon" data-uname="${username}" data-type="1" data-show_reply="true" data-replymid="0" data-uid="${uid}" data-ts="${timestamp}" data-ct="${ct}" data-danmaku="cat" data-file-id="text_cat" data-image="${image}">
  <div class="danmaku-item-left">
    ${getFansMedalElem(level)}
    <div class="common-nickname-wrapper">
      <span class="user-name v-middle pointer open-menu">${username} : </span>
    </div>
  </div>
  <span class="danmaku-item-right v-middle ts-dot-2 pointer emoticon"><img class="open-menu"  src="${image}"  alt="赞"  onerror="this.classList.add('error')"/><span class="open-menu">cat</span></span>
</div>`;

    
    return stringToNode(elem);
}
