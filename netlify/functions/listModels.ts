import { Handler } from "@netlify/functions";
import fetch from 'node-fetch';

export const handler: Handler = async () => {
  const API_KEY = process.env.GEMINI_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "La API Key de Gemini no está configurada." }),
    };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
    
    console.log("Fetching models from:", url);
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Error de la API de Google: ${JSON.stringify(data)}`);
    }

    // Filtramos para mostrar solo los modelos que pueden generar contenido
    const usableModels = data.models.filter(model => 
        model.supportedGenerationMethods.includes("generateContent")
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(usableModels, null, 2),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};