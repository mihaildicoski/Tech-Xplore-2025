// Heads up: From a backend perspective, this is the file you will likely edit the most
// In this file there are tools that the MCP server will expose to the Chat Agent

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "cloudflare:workers";
import { generateText, type LanguageModelV1 } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { openai } from "@ai-sdk/openai";
import { getModel } from "./utils";

// To use Cloudflare Worker AI, uncomment the below
// import { createWorkersAI } from 'workers-ai-provider';
// const workersai = createWorkersAI({ binding: env.AI });
// const model = workersai("@cf/meta/llama-3-8b-instruct")

// Based on value of `env.MODEL_PROVIDER`, we will either use Azure or OpenAI as the model provider.
let model : LanguageModelV1 | undefined = undefined;
if (env.MODEL_PROVIDER == "azure") {
  const azure = createAzure({
    resourceName: env.AI_AZURE_RESOURCE_NAME, // Azure resource name
    apiKey: env.AI_AZURE_API_KEY, // Azure API key
  });
  model = azure(env.AI_AZURE_MODEL_DEPLOYMENT);
}
else
{
  // This uses the OPENAI_API_KEY environment variable/secret by default
  model = openai(env.OPENAI_API_MODEL);
}


export class MyMCP extends McpAgent {
	// @ts-ignore
	server = new McpServer({
		name: "Starter",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"getLocalTime",
			"Get the local time for a specified location",
			{
				location: z.string()
			},
			async ({ location }) => {
				return { content: [{ type: "text", text: String("It is 10am in "+location) }] };
			}
		);


		this.server.tool(
			"getWeatherInformation",
			"Get the weather for a specified location",
			{
				location: z.string()
			},
			async ({ location }) => {
				return { content: [{ type: "text", text: String("It is sunny in " + location) }] };
			}
		);

		this.server.tool(
			"tellAJoke",
			"Tell a random joke",
			{}, // no parameters
			async () => {
				// if IS_LOCAL, mock out call to remote api
				if (env.IS_LOCAL) {
					return { content: [{ type: "text", text: "Why did the scarecrow win an award? Because he was outstanding in his field!" }] };
				} else {
					// otherwise, get a joke from https://api.api-ninjas.com/v1/jokes
					const response = await fetch("https://official-joke-api.appspot.com/random_joke");
					// Example response: {"type":"general","setup":"Why did the girl smear peanut butter on the road?","punchline":"To go with the traffic jam.","id":324}
					if (!response.ok) {
						throw new Error("Failed to fetch joke");
					}
					interface Joke {
						type: string;
						setup: string;
						punchline: string;
						id: number;
					}
					const joke = await response.json() as Joke;
					return { content: [{ type: "text", text: `${joke.setup} ${joke.punchline}` }] };
				}
			}
		);


		this.server.tool(
			"getFactAboutTopic",
			"Get a random fact about a particular topic",
			{
				topic : z.string()
			},
			async ({topic }) => {
				// use AI to generate a random cat fact (check out generateObject too! Very powerful)
				const result = await generateText({
					model : getModel(model),
					system: "You are a helpful assistant that generates facts about a given topic.",
					messages: [
						{
							role: "user",
							content: "Generate a random fact about " + topic + ". Keep it concise and informative."
						}
					],
				});
				return { content: [{ type: "text", text: String(result.text) }] };
			}
		);
	}
}