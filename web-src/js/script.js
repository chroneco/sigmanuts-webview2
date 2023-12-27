
var connection;
var testConnection;
const messageDelay = 40;

var signalRscript = "https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/6.0.1/signalr.js"


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
    console.log("attempting..");

    //document.querySelectorAll("section").forEach(elem => { elem.remove(); });

    let t = typeof livePlayer;
    console.log(t);

    while (t == "undefined") {
        await sleep(100);
        t = typeof livePlayer;
        console.log(t);
    }
    livePlayer.volume(0);
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
    console.log(node);
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
        console.log(deletedNodes);
        for (let i = 0; i < deletedNodes.length; i++) {
            deletedNodes[i].remove();
        }
    }
}

function startStream() {
    const callback = async (mutationList, observer) => {               
        console.log(mutationList);
        await sleep(messageDelay);
        for (let i = 0; i < mutationList.length; i++) {
            for (var j = 0; j < mutationList[i].addedNodes.length; j++) {
                processNode(mutationList[i].addedNodes[j]);
            }

            for (j = 0; j < mutationList[i].removedNodes.length; j++) {
                var removed_id = mutationList[i].removedNodes[j].id
                var detail = {
                    "listener": "delete-message",
                    "event": {
                        "service": "bili",
                        "data": {
                            "time": Date.now(),
                            "msgId": removed_id
                        }
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

function processNode(node, data = undefined) {

    let detailBasic;

    detailBasic = raiseBasicBiliEvent(node, "message");
    sendPayload(detailBasic);
    return;

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