// Heads up: This is the code for your ChatAgent, each user gets routed to a unique instance of this agent.

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
  tool,
  type LanguageModelV1,
} from "ai";
import { z } from "zod";
import { createAzure } from '@ai-sdk/azure';
import { openai } from '@ai-sdk/openai';
import { processToolCalls } from "./utils";
import { env } from "cloudflare:workers";
import { registerToolsFromMcpServer } from "./tools";
import { getModel } from "./utils";

// To use Cloudflare Worker AI, uncomment the below
// import { createWorkersAI } from 'workers-ai-provider';
// const workersai = createWorkersAI({ binding: env.AI });
// const model = workersai("@hf/nousresearch/hermes-2-pro-mistral-7b")

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



interface ChatAgentState {
  userName?: string;
}


/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env, ChatAgentState> {
  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */

  initialState: ChatAgentState = {
  };

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const {mcpAgentTools, executions, mcpConnectionId } = await registerToolsFromMcpServer(
        this.mcp,
        env.IS_LOCAL ? "http://localhost:5173/sse" : env.MCP_TOOLS_URL
       );

       

    // Tools that are locally defined to the ChatAgent (as opposed to the McpAgent)
    // You can use these tools to manage the state of the Chat Agent 
    // There is a limitation when using the McpAgent to do this, since at the moment you cannot guarantee that
    // the McpAgent you connect to via the ChatAgent's MCP client is always the same one
    // ================= CHAT AGENT DEFINED TOOLS =========================
    const getUserInfo = tool({
      description: "Get the user's name",
      parameters: z.object({}),
      execute: async () => {
        return { content: [{ type: "text", text: `The user's name is ${this.state.userName || "unknown"}` }] };  
      },
    });

    // ===================== END CHAT AGENT DEFINED TOOLS ========================

    const chatAgentTools = { getUserInfo };

    // Collect all tools, including MCP tools
    const allTools = {
      ...chatAgentTools,
      ...mcpAgentTools
    };

    // Create a streaming response that handles both text and tool outputs
    const dataStreamResponse = createDataStreamResponse({
      execute: async (dataStream) => {
        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: this.messages,
          dataStream,
          tools: allTools,
          executions : executions
        });

        // Stream the AI response using the Workers AI model
        const result = streamText({
          model : getModel(model),
          system: `You are a helpful assistant that uses the responses from tools to answer the user's query.`,
          messages: processedMessages,
          tools: allTools,
          onFinish: async (args) => {
            onFinish(
              args as Parameters<StreamTextOnFinishCallback<ToolSet>>[0]
            );
            await this.mcp.closeConnection(mcpConnectionId);
          },
          onError: (error) => {
            console.error("Error while streaming:", error);
          },
          maxSteps: 100,
        });

        // Merge the AI response stream with tool execution outputs
        result.mergeIntoDataStream(dataStream);

        // wait for 0.5 seconds
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    });


    return dataStreamResponse;
  }
}