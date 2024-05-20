import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
dotenv.config();

const genAI = new GoogleGenerativeAI("AIzaSyAsZOMGQmUQK0da1pQwO9TK3hw2Bo6vKL4");

const app = express();
app.use(express.json());
app.use(cors({
  origin: 'https://ai-life-coach-gemini-9kbzs4j7x-faiz-ps-projects.vercel.app' // Replace with your actual Vercel URL
}));

const port = process.env.PORT || 3000;

let conversationHistory = [];
const entryPrompt = `
You are a helpful and knowledgeable assistant. Please act as my career advisor, ask necessary questions to understand me more, and suggest the most suitable career path for me. Note to ask only one question at a time.
Each response should be a JSON object with the following properties:
- text: the response text
- facialExpression: one of "smile", "sad", "angry", "surprised", "funnyFace", or "default"
- animation: one of "Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", or "Angry"
`;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.aiff audios/message_${message}.wav`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
    `./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

async function generateAudioFile(fileName, voice, text) {
  return new Promise((resolve, reject) => {
    const sanitizedText = typeof text === 'string' ? text.replace(/[^\w\s]/gi, '') : '';
    exec(`say -v ${voice} -o audios/${fileName}.aiff '${sanitizedText}'`, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) {
    res.status(400).json({ error: "Empty message" });
    return;
  }

  try {
    const previousConversations = conversationHistory.map(entry => entry.userMessage);

    // Add entry prompt to the beginning of the conversation history if it's empty
    if (conversationHistory.length === 0) {
      conversationHistory.push({ role: "system", content: entryPrompt });
    }

    conversationHistory.push({ role: "user", content: userMessage });

    const generationConfig = {
      stopSequences: [""],
      maxOutputTokens: 200,
      temperature: 0.9,
      topP: 0.1,
      topK: 16,
    };

    const model = genAI.getGenerativeModel({ model: "gemini-pro", generationConfig });

    // Construct the prompt from the conversation history
    const prompt = conversationHistory.map(entry => {
      return entry.role === "user" ? `User: ${entry.content}` : entry.content;
    }).join("\n");

    const result = await model.generateContent(prompt);
    const response = await result.response;

    // Add the model's response to the conversation history
    conversationHistory.push({ role: "model", content: response.text() });

    const messages = [response];
    
    // Parsing the model's response as JSON
    const modelResponse = JSON.parse(response.text());

    const responses = [];

    for (let i = 0; i < messages.length; i++) {
      const message = modelResponse;
      const fileName = `message_${i}`;
      const textInput = message.text;
      const voice = 'Samantha';
      await generateAudioFile(fileName, voice, textInput);
      await lipSyncMessage(i);
      responses.push({
        audio: await audioFileToBase64(`audios/${fileName}.wav`),
        lipsync: await readJsonTranscript(`audios/message_${i}.json`),
        facialExpression: message.facialExpression,
        animation: message.animation,
      });
    }

    res.send({ messages: responses, previousConversations });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`listening on port ${port}`);
});
