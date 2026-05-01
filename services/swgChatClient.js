const SOEProtocol = require("./swgChatProtocol");
const dgram = require('dgram');

var server = {};
module.exports.login = function(cfg) {
    server = Object.assign({}, cfg);
    verboseSWGLogging = Boolean(server.verboseSWGLogging);
    SOEProtocol.setVerboseLogging(verboseSWGLogging);
    fails = 0;
    lastMessageTime = new Date();
    Login();
}

var verboseSWGLogging = false;
module.exports.debug = function() {
    verboseSWGLogging = true;
    SOEProtocol.setVerboseLogging(true);
    SOEProtocol.debug();
    console.log(getFullTimestamp() + " - Enabled verbose SWG logging");
}

module.exports.isConnected = false;
module.exports.paused = false;
module.exports.setPaused = function(value) {
    module.exports.paused = Boolean(value);
    return module.exports.paused;
}
module.exports.restart = function() {
    fails = 0;
    lastMessageTime = new Date();
    Login();
}
module.exports.getState = function() {
    return {
        isConnected: module.exports.isConnected,
        paused: module.exports.paused,
        loginAddress: server.LoginAddress || '',
        loginPort: server.LoginPort || 0,
        character: server.Character || '',
        chatRoom: server.ChatRoom || '',
        roomId: server.ChatRoomID || 0,
        serverName: server.SWGServerName || server.ServerName || ''
    };
}
module.exports.sendChat = function(message, user) {
    if (!module.exports.isConnected) return;
    if (verboseSWGLogging) console.log(getFullTimestamp() + " - sending chat to game: " + user + ": " + message);
    send("ChatSendToRoom", {Message: ' \\#ff3333' + user + ': \\#ff66ff' + message, RoomID: server.ChatRoomID});
}
module.exports.recvChat = function(message, player) {}
module.exports.serverDown = function() {}
module.exports.serverUp = function() {}
module.exports.reconnected = function() {}
module.exports.sendTell = function(player, message) {
    if (!module.exports.isConnected) return;
    if (player != server.Character)
    	console.log(getFullTimestamp() + " - sending tell to: " + player + ": " + message);
    send("ChatInstantMessageToCharacter", {ServerName: server.ServerName, PlayerName: player, Message: message});
}
module.exports.recvTell = function(from, message) {}

var lastMessageTime = new Date();


function handleMessage(msg, info) {
    lastMessageTime = new Date();
    if (info.port == server.PingPort) return;
    var packets;
    try {
        var header = msg.readUInt16BE(0);
        packets = SOEProtocol.Decode(msg);
        // If packets is not an array, convert it to an array with a single element
        if (!Array.isArray(packets)) {
            packets = [packets];
        }
    } catch (ex) {
        console.log(getFullTimestamp() + " - Exception with header: " + header.toString(16).toUpperCase().padStart(4, 0))
        console.log(getFullTimestamp() + " - " + ex.toString());
        Login();
        return;
    }

    // Process packets once
    processPackets(packets);
}

function processPackets(packets) {
    // Check if packets is not an array
    if (packets === undefined || !Array.isArray(packets)) {
        //console.log("Invalid packets:", packets);
        return;
    }
    for (var packet of packets) {
        // Check if packet is defined and contains the type property
        if (packet && packet.type) {
            if (verboseSWGLogging)
                console.log(getFullTimestamp() + " - recv: " + packet.type);
            if (handlePacket[packet.type])
                handlePacket[packet.type](packet);
        } else {
           // console.log("Invalid packet:", packet);
        }
    }
}


var socket;
var loggedIn;

var handlePacket = {};
handlePacket["Ack"] = function(packet) {}   //This is Ack packet from server, no response required
handlePacket["SessionResponse"] = function(packet) {
    if (!loggedIn) {
        send("LoginClientID", {Username: server.Username, Password:server.Password});
    }
    else {
        send("ClientIdMsg");
    }
}
handlePacket["LoginClientToken"] = function(packet) {
    console.log(getFullTimestamp() + " - Logged into SWG login server");
    loggedIn = true;
}
handlePacket["LoginEnumCluster"] = function(packet) {
    server.ServerNames = packet.Servers;
}
handlePacket["LoginClusterStatus"] = function(packet) {
    if (verboseSWGLogging) console.log(packet);
    server.Servers = packet.Servers;
}
handlePacket["EnumerateCharacterId"] = function(packet) {
    var character = packet.Characters[server.Character];
    if (!character)
        for (var c in packet.Characters)
            if (packet.Characters[c].Name.startsWith(server.Character))
                character = packet.Characters[c];
    if (!character) {
        console.log(getFullTimestamp() + " - SWG chat character not found on the account: " + server.Character);
        return;
    }
    var serverData = server.Servers[character.ServerID];
    if (!serverData) {
        console.log(getFullTimestamp() + " - SWG chat server data was missing for character: " + server.Character);
        return;
    }
    server.Address = serverData.IPAddress;
    server.Port = serverData.Port;
    server.PingPort = serverData.PingPort;
    server.CharacterID = character.CharacterID;
    server.ServerName = server.ServerNames[character.ServerID].Name;
    send("SessionRequest");
}
handlePacket["ClientPermissions"] = function(packet) {
    send("SelectCharacter", {CharacterID: server.CharacterID});
    setTimeout(() => {
        send("ChatCreateRoom", {RoomPath: `SWG.${server.ServerName}.${server.ChatRoom}`})
        setTimeout(() => send("CmdSceneReady"), 1000);
    }, 1000);
}
handlePacket["ChatRoomList"] = function(packet) {
    if (verboseSWGLogging) console.log(JSON.stringify(packet, null, 2));
    for (var roomID in packet.Rooms) {
        var room = packet.Rooms[roomID];
        if (room.RoomPath.endsWith(server.ChatRoom)) {
            server.ChatRoomID = room.RoomID;
            send("ChatEnterRoomById", {RoomID: room.RoomID});
        }
    }
}
handlePacket["ChatOnEnteredRoom"] = function(packet) {
    if (verboseSWGLogging) console.log(JSON.stringify(packet, null, 2));
    if (packet.RoomID == server.ChatRoomID && packet.PlayerName == server.Character) {
        if (!module.exports.isConnected) {
            module.exports.isConnected = true;
            console.log(getFullTimestamp() + " - Character " + packet.PlayerName + " logged into SWG and entered chatroom ID# " + packet.RoomID);
            module.exports.reconnected();
        }
        const failureThreshold = Math.max(1, Number(server.failureThreshold || 3));
        if (fails >= failureThreshold) module.exports.serverUp();
        fails = 0;
    }
}
handlePacket["ChatRoomMessage"] = function(packet) {
    if (verboseSWGLogging) console.log(JSON.stringify(packet, null, 2));
    if (packet.RoomID == server.ChatRoomID && packet.CharacterName != server.Character.toLowerCase())
        module.exports.recvChat(packet.Message, packet.CharacterName);
}
handlePacket["ChatInstantMessageToClient"] = function(packet) {
    module.exports.recvTell(packet.PlayerName, packet.Message);
}
handlePacket["ChatOnLeaveRoom"] = function(packet) {
    if (packet.RoomID == server.ChatRoomID && packet.PlayerName == server.Character) {
        console.log(getFullTimestamp() + " - Character " + packet.PlayerName + " has left chatroom ID# " + packet.RoomID + " with error code " + packet.Error);
    }
}

var disconnectCount = 0;
handlePacket["Disconnect"] = function(packet) {
    console.log(getFullTimestamp() + " - Received Disconnect packet from server.  Connection ID = " + packet.connectionID + ".  Reason code = " + packet.reasonID + ".  Disconnect count = " + disconnectCount++);
}

//handlePacket["ServerNetStatusUpdate"] = function(packet) {} //This is network status packet from server, no response required

function Login() {
    loggedIn = false;
    module.exports.isConnected = false;
    safeCloseSocket();

    if (!server.LoginAddress || !server.LoginPort) {
        console.log(getFullTimestamp() + " - SWG chat login settings are incomplete.");
        return;
    }

    server.Address = server.LoginAddress; 
    server.Port = server.LoginPort;
    server.PingPort = undefined;    //Undefined until we get ping port from login server

    socket = dgram.createSocket('udp4');
    socket.on('message', handleMessage);
    socket.on('error', (error) => {
        console.log(getFullTimestamp() + " - SWG socket error: " + error.message);
    });

    send("SessionRequest");
}

function safeCloseSocket() {
    if (!socket) {
        return;
    }

    try {
        socket.removeAllListeners('message');
        socket.removeAllListeners('error');
        socket.close();
    } catch (error) {
        // ignore socket cleanup failures
    }

    socket = null;
}

function send(type, data) {
    if (!socket) {
        return;
    }

    var buf = SOEProtocol.Encode(type, data);
    if (buf) {
        if (verboseSWGLogging)
            console.log(getFullTimestamp() + " - send: " + type);
        if (Array.isArray(buf)) {
            for (var b of buf) {
                socket.send(b, server.Port, server.Address);
            }
        }
        else
            socket.send(buf, server.Port, server.Address);
    }
}

var fails = 0;
setInterval(() => {
    if (module.exports.paused) return;
    send("Ack");
    const connectionTimeoutMs = Math.max(1000, Number(server.connectionTimeoutMs || 10000));
    const failureThreshold = Math.max(1, Number(server.failureThreshold || 3));
    if (new Date() - lastMessageTime > connectionTimeoutMs) {
        fails++;
        module.exports.isConnected = false;
        if (fails == failureThreshold) module.exports.serverDown();
        lastMessageTime = new Date();
        Login();
    }
}, 100);

setInterval(() => {
    if (!server.PingPort || !module.exports.isConnected)
        return;
    var buf = Buffer.alloc(4);                          //Server requires 4 byte packet, going to have it match what standard client sends, not what is in the documentation
    var tick = new Date().getTime() & 0xFFFF;           //Convert to uint16 
    buf.writeUInt16BE(tick, 0);                         //Big or Little Endian?  Doesn't matter right now.
    buf.writeUInt16BE(0x7701, 2);                       //77 01 matches client ping
    socket.send(buf, server.PingPort, server.Address);  //Send to the ping server IP and port
}, 1 * 1000);                                           //Let's send a ping every 1.0 seconds like the client

setInterval(() => {
    if (!module.exports.isConnected) return;
	send("ClientNetStatusRequest");                     //Going to send a net status packet every 15 seconds (standard client is 15)
}, 15 * 1000);

 //Custom timestamp generator
 function getFullTimestamp() {

    date = new Date();
    year = date.getFullYear().toString().padStart(4, '0') + "-";
    month = (date.getMonth()+1).toString().padStart(2, '0') + "-";
    day = date.getDate().toString().padStart(2, '0') + " ";
    hours = date.getHours().toString().padStart(2, '0') + ":";
    minutes = date.getMinutes().toString().padStart(2, '0') + ":";
    seconds = date.getSeconds().toString().padStart(2, '0') + ".";
    millisecs = date.getMilliseconds().toString().padStart(3, '0');

    return year + month + day + hours + minutes + seconds + millisecs;
}
