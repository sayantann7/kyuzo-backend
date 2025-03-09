const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const passport = require("passport");
const userModel = require("./models/users");
const quizModel = require("./models/quizzes");
const localStrategy = require("passport-local");
const expressSession = require("express-session");
passport.use(new localStrategy(userModel.authenticate()));
const flash = require("connect-flash");
const host = process.env.FRONTEND_HOST;
const MongoStore = require("connect-mongo");
const mongoURI = process.env.MONGODB_URI;
const quizResultModel = require("./models/quizResults");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  expressSession({
    secret: "ihqwdhioqhf",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: mongoURI,
      collectionName: "sessions",
    }),
  })
);
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser(userModel.serializeUser());
passport.deserializeUser(userModel.deserializeUser());

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(flash());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});


try {
  mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("MongoDB connected");
} catch (error) {
  console.log("MongoDB connection error", error);
}

app.get("/", (req, res) => {
  res.send("Express server is running");
});

// Helper function to update user XP and level
const updateUserXPAndLevel = async (userId, xpToAdd) => {
  const user = await userModel.findById(userId);
  if (!user) return;

  user.xp += xpToAdd;
  while (user.xp >= user.xpToNextLevel) {
    user.level += 1;
    user.xpToNextLevel += 100;
  }

  await user.save();
};

// Helper function to update daily streak
const updateDailyStreak = async (userId) => {
  const user = await userModel.findById(userId);
  if (!user) return;

  const now = new Date();
  const lastSignedIn = new Date(user.lastSignedIn);
  const diffDays = Math.floor((now - lastSignedIn) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) {
    user.dailyStreak += 1;
  } else if (diffDays > 1) {
    user.dailyStreak = 1;
  }

  user.lastSignedIn = now;
  await user.save();
};

// Helper function to update average score
const updateAverageScore = async (userId) => {
  const results = await quizResultModel.find({ userId });
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  const averageScore = totalScore / results.length;

  await userModel.findByIdAndUpdate(userId, { averageScore });
};

app.post("/signup", (req, res) => {
  let userData = new userModel({
    username: req.body.name,
    fullname: req.body.fullname,
    email: req.body.email,
  });

  userModel
    .register(userData, req.body.password)
    .then((registeredUser) => {
      req.logIn(registeredUser, (err) => {
        if (err) {
          console.error("Login error after registration:", err);
          req.flash("error", "Login failed after registration.");
          return res.json({ error: "Login failed after registration." });
        }
        // Successful registration and login
        return res.json({ success: "Registration successful.", userId: registeredUser._id });
      });
    })
    .catch((err) => {
      console.error("Registration error:", err);
      req.flash("error", err.message);
      res.json({ error: err.message });
    });
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: "An error occurred during authentication." });
    }
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({ error: "Login failed." });
      }
      return res.json({ success: "Login successful.", userId: user._id });
    });
  })(req, res, next);
});

app.get("/leaderboard", async (req, res) => {
  try {
    const users = await userModel.find({});
    const rankedUsers = users
      .map(user => ({
        id: user._id,
        name: user.fullname,
        avatar: user.avatar,
        xp: user.xp,
        dailyStreak: user.dailyStreak,
        totalScore: user.xp + user.dailyStreak
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 10); // Get top 10 users

    res.status(200).json(rankedUsers);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "An error occurred while fetching the leaderboard" });
  }
});

app.post("/createQuiz/:userId", async (req, res) => {
  try {
    const { title, description, category, difficulty, duration, tags, isPublic, questions } = req.body;
    const createdBy = req.params.userId;

    const newQuiz = new quizModel({
      title,
      description,
      category,
      difficulty,
      duration,
      tags,
      isPublic,
      questions,
      createdBy,
    });

    await newQuiz.save();
    await updateUserXPAndLevel(createdBy, 2); // Add 2 XP for creating a quiz
    await updateDailyStreak(createdBy);

    // Update last activity
    const user = await userModel.findById(createdBy);
    user.lastActivity = `Created a new quiz on "${title}"`;
    await user.save();

    res.status(201).json({ success: "Quiz created successfully", quizId: newQuiz._id });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res.status(500).json({ error: "An error occurred while creating the quiz" });
  }
});

app.get("/getUserDetails/:id", async (req,res)=> {
  const user = await userModel.findOne({
    _id: req.params.id,
  }).populate("quizzes").populate("friends").populate("friendRequests");
  await updateAverageScore(req.params.id);
  res.send(user);
})

app.get("/getQuizzesTaken/:userId", async (req, res) => {
  try {
    const quizzesTakenCount = await quizResultModel.countDocuments({ userId: req.params.userId });
    res.json({ quizzesTaken: quizzesTakenCount });
  } catch (error) {
    console.error("Error fetching quizzes taken count:", error);
    res.status(500).json({ error: "An error occurred while fetching the quizzes taken count" });
  }
});

app.get("/getQuizzes/:userId", async (req, res) => {
  try {
    const quizzes = await quizModel.find({ createdBy: req.params.userId });
    res.json(quizzes);
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ error: "An error occurred while fetching quizzes" });
  }
});

app.get("/getQuiz/:id", async (req, res) => {
  try {
    const quiz = await quizModel.findById(req.params.id);
    res.json(quiz);
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ error: "An error occurred while fetching the quiz" });
  }
});

app.get("/getQuiz/:id", async (req, res) => {
  try {
    const quiz = await quizModel.findById(req.params.id);
    res.json(quiz);
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ error: "An error occurred while fetching the quiz" });
  }
});

app.get("/getQuizResults/:userId", async (req, res) => {
  try {
    const results = await quizResultModel.find({ userId: req.params.userId }).populate("quizId");
    res.json(results);
  } catch (error) {
    console.error("Error fetching quiz results:", error);
    res.status(500).json({ error: "An error occurred while fetching quiz results" });
  }
});




app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect(`${host}/`);
  });
});

app.post("/submitQuiz", async (req, res) => {
  try {
    const { quizId, userId, answers, score, timeSpent } = req.body;

    if (!quizId || !userId) {
      return res.status(400).json({ error: "Quiz ID and User ID are required." });
    }

    const quiz = await quizModel.findById(quizId);
    const newQuizResult = new quizResultModel({
      quizId,
      userId,
      answers,
      score,
      timeSpent,
    });

    await newQuizResult.save();
    await updateUserXPAndLevel(userId, Math.floor(score / 10)); // Add XP based on score

    // Update last activity
    const user = await userModel.findById(userId);
    user.lastActivity = `Took a quiz on "${quiz.title}" and scored ${score}%`;
    await user.save();

    res.status(201).json({ success: "Quiz result submitted successfully", resultId: newQuizResult._id });
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res.status(500).json({ error: "An error occurred while submitting the quiz" });
  }
});

app.post("/sendFriendRequestByUsername", async (req, res) => {
  try {
    const { senderId, username } = req.body;

    const receiver = await userModel.findOne({ username });
    if (!receiver) {
      return res.status(404).json({ error: "User not found" });
    }

    if (receiver.friendRequests.includes(senderId)) {
      return res.status(400).json({ error: "Friend request already sent" });
    }

    receiver.friendRequests.push(senderId);
    await receiver.save();

    res.status(200).json({ success: "Friend request sent", fullname: receiver.fullname });
  } catch (error) {
    console.error("Error sending friend request:", error);
    res.status(500).json({ error: "An error occurred while sending the friend request" });
  }
});

app.post("/generateQuiz", async (req, res) => {
  try {
    const { topic, numberOfQuestions, difficulty, userId } = req.body;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });

    const prompt = `Generate a quiz with the following details:
    Topic: ${topic}
    Number of Questions: ${numberOfQuestions}
    Difficulty: ${difficulty}
    Format: Each question should have an id, question text, options (with ids and text), and a correct option id. The quiz should also have a title, description, category, difficulty, duration, tags, isPublic, and createdBy fields.
    Example:
    {
      title: "Sample Quiz",
      description: "This is a sample quiz",
      category: "${topic}",
      difficulty: "${difficulty}",
      duration: 10,
      tags: ["sample", "quiz"],
      isPublic: true,
      questions: [
        {
          id: "1",
          question: "Sample question?",
          options: [
            { id: "a", text: "Option A" },
            { id: "b", text: "Option B" },
            { id: "c", text: "Option C" },
            { id: "d", text: "Option D" }
          ],
          correctOptionId: "a"
        }
      ],
      createdBy: "${userId}"
    }`;

    const result = await model.generateContent(prompt);
    // const quizData = JSON.parse(result.response.candidates[0].content.parts[0].text);

    console.log(result);

    // const newQuiz = new quizModel(quizData);
    // await newQuiz.save();
    // await updateUserXPAndLevel(userId, 2); // Add 2 XP for creating a quiz
    // await updateDailyStreak(userId);

    res.status(201).json({ success: "Quiz generated successfully", quizId: "8322058215" });
  } catch (error) {
    console.error("Error generating quiz:", error);
    res.status(500).json({ error: "An error occurred while generating the quiz" });
  }
});

// Route to accept a friend request
app.post("/acceptFriendRequest", async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    const user = await userModel.findById(userId);
    const friend = await userModel.findById(friendId);

    if (!user || !friend) {
      return res.status(404).json({ error: "User not found" });
    }

    user.friends.push(friendId);
    friend.friends.push(userId);

    user.friendRequests = user.friendRequests.filter(id => id.toString() !== friendId);
    await user.save();
    await friend.save();

    res.status(200).json({ success: "Friend request accepted" });
  } catch (error) {
    console.error("Error accepting friend request:", error);
    res.status(500).json({ error: "An error occurred while accepting the friend request" });
  }
});

app.get("/getFriends/:userId", async (req, res) => {
  try {
    const user = await userModel.findById(req.params.userId).populate("friends");
    res.json(user.friends);
  } catch (error) {
    console.error("Error fetching friends:", error);
    res.status(500).json({ error: "An error occurred while fetching friends" });
  }
});

// Route to get friend requests
app.get("/getFriendRequests/:userId", async (req, res) => {
  try {
    const user = await userModel.findById(req.params.userId).populate("friendRequests");
    res.json(user.friendRequests);
  } catch (error) {
    console.error("Error fetching friend requests:", error);
    res.status(500).json({ error: "An error occurred while fetching friend requests" });
  }
});

// Route to get friend suggestions
app.get("/getFriendSuggestions/:userId", async (req, res) => {
  try {
    const user = await userModel.findById(req.params.userId);
    const suggestions = await userModel.find({ _id: { $ne: user._id, $nin: user.friends } }).limit(10);
    res.json(suggestions);
  } catch (error) {
    console.error("Error fetching friend suggestions:", error);
    res.status(500).json({ error: "An error occurred while fetching friend suggestions" });
  }
});

// Route to get friends' latest activities
app.get("/getFriendsActivities/:userId", async (req, res) => {
  try {
    const user = await userModel.findById(req.params.userId).populate('friends');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const activities = await quizResultModel.find({ userId: { $in: user.friends } }).populate('quizId').sort({ createdAt: -1 }).limit(10);
    res.json(activities);
  } catch (error) {
    console.error("Error fetching friends' activities:", error);
    res.status(500).json({ error: "An error occurred while fetching friends' activities" });
  }
});

app.get("/getQuizResult/:id", async (req, res) => {
  try {
    const result = await quizResultModel.findById(req.params.id).populate("quizId");
    if (!result) {
      return res.status(404).json({ error: "Quiz result not found" });
    }
    res.json(result);
  } catch (error) {
    console.error("Error fetching quiz result:", error);
    res.status(500).json({ error: "An error occurred while fetching the quiz result" });
  }
});

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else {
    res.redirect(`${host}/login`);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
