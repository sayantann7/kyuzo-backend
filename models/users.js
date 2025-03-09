const mongoose = require('mongoose');
const plm = require('passport-local-mongoose');

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true 
  },
  fullname : {
    type: String,
    required: true
  },
  email: { 
    type: String, 
    required: true, 
    unique: true 
  },
  password: { 
    type: String,
  },
  xp: { 
    type: Number, 
    default: 0 
  },
  dailyStreak: { 
    type: Number, 
    default: 0 
  },
  averageScore: {
    type: Number,
    default: 0
  },
  level: {
    type: Number,
    default: 1
  },
  xpToNextLevel: {
    type: Number,
    default: 100
  },
  lastSignedIn: { 
    type: Date,
    default: Date.now 
  },
  lastActivity: {
    type: String,
    default: ''
  },
  friends: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  friendRequests: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  quizzes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz'
  }],
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

userSchema.plugin(plm);

module.exports = mongoose.model('User', userSchema);