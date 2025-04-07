const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "http://13.51.162.118:3000", // Frontend URL
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    lastSeen: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
    senderName: String,
    receiverName: String,
    message: String,
    status: String,
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// Store connected users
const connectedUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('join', async (userData) => {
        const username = userData.senderName;
        try {
            // Update or create user
            await User.findOneAndUpdate(
                { username },
                { username, lastSeen: new Date() },
                { upsert: true }
            );

            // Store the socket ID for this user
            connectedUsers.set(username, socket.id);
            // Join the public chatroom
            socket.join('chatroom');
            // Join user's personal room
            socket.join(username);
            // Notify others about the new user
            io.emit('userJoined', { senderName: username });
            console.log(`${username} joined the chat`);
        } catch (error) {
            console.error('Error handling user join:', error);
        }
    });

    socket.on('message', async (message) => {
        try {
            console.log('Received message:', message);
            // Save message to MongoDB
            const newMessage = new Message(message);
            await newMessage.save();

            // Broadcast message to all clients in the chatroom
            io.to('chatroom').emit('message', message);
            console.log(`Broadcasted message from ${message.senderName}: ${message.message}`);
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    // Replace the privateMessage socket handler in your backend with this improved version
    socket.on('privateMessage', async (message) => {
        try {
            console.log('Received private message:', message);
            // Save private message to MongoDB
            const newMessage = new Message(message);
            await newMessage.save();

            // Get the receiver's socket ID
            const receiverSocketId = connectedUsers.get(message.receiverName);

            // Send to the specific receiver if they're online
            if (receiverSocketId) {
                // Important: emit to the specific socket, not the room
                io.to(receiverSocketId).emit('privateMessage', message);
                console.log(`Sent private message to receiver ${message.receiverName}`);
            } else {
                console.log(`User ${message.receiverName} not found or offline`);
            }

            // Also emit back to the sender
            socket.emit('privateMessage', message);
            console.log(`Sent private message back to sender ${message.senderName}`);
        } catch (error) {
            console.error('Error handling private message:', error);
        }
    });

    socket.on('disconnect', () => {
        // Find and remove the disconnected user
        for (const [username, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                connectedUsers.delete(username);
                io.emit('userLeft', { senderName: username });
                console.log(`${username} left the chat`);
                break;
            }
        }
    });
});

// REST API endpoints
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find().sort({ timestamp: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching messages' });
    }
});

app.get('/api/messages/:username', async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { senderName: req.params.username },
                { receiverName: req.params.username }
            ]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching user messages' });
    }
});

// User endpoints
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find().sort({ lastSeen: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
});

// Add this endpoint after the existing user endpoints
app.post('/api/users', async (req, res) => {
    try {
        const { username } = req.body;
        // Update or create user
        await User.findOneAndUpdate(
            { username },
            { username, lastSeen: new Date() },
            { upsert: true }
        );
        res.status(200).json({ username, success: true });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Error registering user' });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 