import { Handler, HandlerEvent } from "@netlify/functions";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      throw new Error("La API Key de Gemini no está configurada.");
    }

    // --- CAMBIO IMPORTANTE AQUÍ ---
    // Construimos la ruta al archivo JSON de forma segura
    const knowledgeBasePath = path.join(__dirname, '../../knowledge_base.json');
    // Leemos el archivo como texto
    const knowledgeBaseJSON = fs.readFileSync(knowledgeBasePath, "utf-8");
    // Lo parseamos a un objeto
    const knowledgeBase = JSON.parse(knowledgeBaseJSON);
    // ----------------------------

    const userPrompt = JSON.parse(event.body || '{}').prompt;
    if (!userPrompt) {
      return { statusCode: 400, body: 'Falta el prompt en la petición.' };
    }

    const contextText = JSON.stringify(knowledgeBase);
    const finalPrompt = `
      Contexto: Eres un asistente experto en el sistema de diseño de Angular.
      Usa SÓLO los componentes y propiedades descritos en el siguiente JSON de contexto:
      ${contextText}

      Petición: Usando el contexto anterior, genera el código HTML y TypeScript para un componente de Angular que cumpla con la siguiente petición: "${userPrompt}"
      
      Respuesta:
    `;
    
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" })
    const result = await model.generateContent(finalPrompt);
    const response = await result.response;
    const code = response.text();

    return {
      statusCode: 200,
      body: JSON.stringify({ code: code }),
    };

  } catch (error) {
    // Devolvemos el mensaje de error para poder depurar mejor
    return { 
      statusCode: 500, 
      body: JSON.stringify({ message: error.message, stack: error.stack }) 
    };
  }
};