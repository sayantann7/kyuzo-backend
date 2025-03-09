const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema({
  id: String,
  text: String,
});

const questionSchema = new mongoose.Schema({
  id: String,
  question: String,
  options: [optionSchema],
  correctOptionId: String,
  explanation: String,
});

const quizSchema = new mongoose.Schema({
  title: String,
  description: String,
  category: String,
  difficulty: String,
  duration: Number,
  tags: [String],
  isPublic: Boolean,
  questions: [questionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

module.exports = mongoose.model("Quiz", quizSchema);