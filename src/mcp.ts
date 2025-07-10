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
let model: LanguageModelV1 | undefined = undefined;
if (env.MODEL_PROVIDER == "azure") {
  const azure = createAzure({
    resourceName: env.AI_AZURE_RESOURCE_NAME, // Azure resource name
    apiKey: env.AI_AZURE_API_KEY, // Azure API key
  });
  model = azure(env.AI_AZURE_MODEL_DEPLOYMENT);
} else {
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
        location: z.string(),
      },
      async ({ location }) => {
        return {
          content: [
            { type: "text", text: String("It is 10am in " + location) },
          ],
        };
      }
    );

    this.server.tool(
      "getWeatherInformation",
      "Get the weather for a specified location",
      {
        location: z.string(),
      },
      async ({ location }) => {
        return {
          content: [
            { type: "text", text: String("It is sunny in " + location) },
          ],
        };
      }
    );

    this.server.tool(
      "tellAJoke",
      "Tell a random joke",
      {}, // no parameters
      async () => {
        // if IS_LOCAL, mock out call to remote api
        if (env.IS_LOCAL) {
          return {
            content: [
              {
                type: "text",
                text: "Why did the scarecrow win an award? Because he was outstanding in his field!",
              },
            ],
          };
        } else {
          // otherwise, get a joke from https://api.api-ninjas.com/v1/jokes
          const response = await fetch(
            "https://official-joke-api.appspot.com/random_joke"
          );
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
          const joke = (await response.json()) as Joke;
          return {
            content: [
              { type: "text", text: `${joke.setup} ${joke.punchline}` },
            ],
          };
        }
      }
    );

    this.server.tool(
      "getFactAboutTopic",
      "Get a random fact about a particular topic",
      {
        topic: z.string(),
      },
      async ({ topic }) => {
        // use AI to generate a random cat fact (check out generateObject too! Very powerful)
        const result = await generateText({
          model: getModel(model),
          system:
            "You are a helpful assistant that generates facts about a given topic.",
          messages: [
            {
              role: "user",
              content:
                "Generate a random fact about " +
                topic +
                ". Keep it concise and informative.",
            },
          ],
        });
        return { content: [{ type: "text", text: String(result.text) }] };
      }
    );

    this.server.tool(
      "getFinancialAdvice",
      "Get a summary of your financial health and advice based on current budget and goals",
      {}, // no parameters required
      async () => {
        const response = await fetch(
          "http://localhost:8787/api/financial-advice"
        );
        if (!response.ok) {
          throw new Error("Failed to fetch financial advice");
        }

        const data: any = await response.json();

        const summary = `
		  Financial Health Score: ${data.financialHealthScore}
		  
		  Budget:
		  - Monthly Income: R${data.budgetAnalysis.monthlyIncome}
		  - Monthly Expenses: R${data.budgetAnalysis.monthlyExpenses}
		  - Savings Rate: ${data.budgetAnalysis.savingsRate}%
		  - Emergency Fund: ${data.budgetAnalysis.emergencyFundMonths} months
		  
		  Advice:
		  ${data.advice.map((item: any) => `• [${item.category}] (${item.priority}): ${item.recommendation} (Save R${item.potentialSaving})`).join("\n")}
		  
		  Goals:
		  ${data.goals.map((goal: any) => `• ${goal.name}: ${goal.progress}% complete – ${goal.timeToGoal} remaining`).join("\n")}
			  `.trim();

        return {
          content: [{ type: "text", text: summary }],
        };
      }
    );

    this.server.tool(
      "getSpendingInsights",
      "Get a breakdown of your monthly spending, category trends, insights, percentage of expenditure on certain categories and upcoming bills",
      {},
      async () => {
        const url = env.IS_LOCAL
          ? "http://localhost:8787/api/spending-insights"
          : "https://your-domain.com/api/spending-insights"; //link for deployed verison *******

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch spending insights");
        }

        interface Category {
          category: string;
          amount: number;
          percentage: number;
          trend: string;
        }

        interface Insight {
          type: string;
          message: string;
          suggestion: string;
        }

        interface Bill {
          merchant: string;
          amount: number;
          dueDate: string;
        }

        const data: {
          monthlySpending: {
            current: number;
            previous: number;
            change: number;
          };
          categoryBreakdown: Category[];
          insights: Insight[];
          upcomingBills: Bill[];
        } = await response.json();

        const summary = `
		  Monthly Spending:
		  - Current: R${data.monthlySpending.current}
		  - Previous: R${data.monthlySpending.previous}
		  - Change: ${data.monthlySpending.change}%
		  
		  Category Breakdown:
		  ${data.categoryBreakdown.map((cat) => `• ${cat.category}: R${cat.amount} (${cat.percentage}%) – Trend: ${cat.trend}`).join("\n")}
		  
		  Insights:
		  ${data.insights.map((insight) => `• (${insight.type.toUpperCase()}) ${insight.message} → ${insight.suggestion}`).join("\n")}
		  
		  Upcoming Bills:
		  ${data.upcomingBills.map((bill) => `• ${bill.merchant}: R${bill.amount} due on ${bill.dueDate}`).join("\n")}
			  `.trim();

        return {
          content: [{ type: "text", text: summary }],
        };
      }
    );

    this.server.tool(
      "getRecommendations",
      "Get personalized financial and sustainability recommendations. This will give a user recommendations for certain financial and sustainability goals like saving, investing, transport and shopping.",
      {},
      async () => {
        const url = env.IS_LOCAL
          ? "http://localhost:8787/api/recommendations"
          : "https://your-domain.com/api/recommendations";

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch recommendations");
        }

        interface FinancialRec {
          type: string;
          title: string;
          description: string;
          action: string;
          potentialSaving: number;
          priority: string;
        }

        interface SustainabilityRec {
          type: string;
          title: string;
          description: string;
          action: string;
          carbonSaving: number;
          moneySaving: number;
          priority: string;
        }

        const data: {
          financial: FinancialRec[];
          sustainability: SustainabilityRec[];
        } = await response.json();

        const summary = `
		Financial Recommendations:
		${data.financial.map((rec) => `• [${rec.priority}] ${rec.title}: ${rec.description}\n  Action: ${rec.action} (Save R${rec.potentialSaving})`).join("\n\n")}
		
		Sustainability Recommendations:
		${data.sustainability.map((rec) => `• [${rec.priority}] ${rec.title}: ${rec.description}\n  Action: ${rec.action} (Save R${rec.moneySaving}, Reduce ${rec.carbonSaving}kg CO₂)`).join("\n\n")}
			`.trim();

        return {
          content: [{ type: "text", text: summary }],
        };
      }
    );

    this.server.tool(
      "getTransactionsSummary",
      "Summarize a number of recent transactions including top spending category, total carbon impact, and recurring expenses. Also lists a specific number of recent transactions and gives insight into the amount, carbon impact, whether it is recurring or not, as well as a date of the transaction. If a count is not specified, then it will just list all of them and give a summary as per usual.",
      {
        count: z.number().min(1).max(20).optional(),
      },
      async ({ count }) => {
        const url = env.IS_LOCAL
          ? "http://localhost:8787/api/transactions"
          : "https://your-domain.com/api/transactions";

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch transactions");
        }

        interface Transaction {
          date: string;
          merchant: string;
          category: string;
          amount: number;
          carbonImpact: number;
          isRecurring: boolean;
          merchantType: string;
        }

        const data: {
          transactions: Transaction[];
          summary: {
            totalSpent: number;
            totalCarbonKg: number;
            recurringTransactions: number;
            topCategory: string;
          };
        } = await response.json();

        const transactionsToUse = count
          ? data.transactions.slice(0, count)
          : data.transactions;

        const transactionList = transactionsToUse
          .map(
            (tx) =>
              `• ${tx.date}: ${tx.merchant} - R${tx.amount.toFixed(2)} (${tx.category})\n  ⮑ Carbon: ${tx.carbonImpact}kg • ${tx.isRecurring ? "Recurring" : "Once-off"}`
          )
          .join("\n\n");

        // redo the totals based on the count
        const totalSpent = transactionsToUse.reduce(
          (sum, tx) => sum + tx.amount,
          0
        );
        const totalCarbon = transactionsToUse.reduce(
          (sum, tx) => sum + tx.carbonImpact,
          0
        );
        const recurringCount = transactionsToUse.filter(
          (tx) => tx.isRecurring
        ).length;
        const categoryTotals: Record<string, number> = {};
        for (const tx of transactionsToUse) {
          if (!categoryTotals[tx.category]) {
            categoryTotals[tx.category] = 0;
          }
          categoryTotals[tx.category] += tx.amount;
        }
        const topCategory =
          Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "N/A";

        const summary = `
  ${transactionsToUse.length} Most Recent Transactions:
  ${transactionList}
  
  Summary (based on listed transactions):
  - Total Spent: R${totalSpent.toFixed(2)}
  - Total Carbon Impact: ${totalCarbon.toFixed(1)}kg CO₂
  - Recurring Charges: ${recurringCount}
  - Top Spending Category: ${topCategory}
	  `.trim();

        return {
          content: [{ type: "text", text: summary }],
        };
      }
    );

    this.server.tool(
      "getInvestmentOptions",
      "Retrieve a list of recommended investments including risk level, expected return, and ESG score",
      {},
      async () => {
        const url = env.IS_LOCAL
          ? "http://localhost:8787/api/investments"
          : "https://your-domain.com/api/investments";

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch investment options");
        }

        interface Investment {
          name: string;
          riskLevel: string;
          recommendedAmount: number;
          expectedReturn: string;
          esgScore: number;
          category: string;
        }

        const data: {
          investments: Investment[];
        } = await response.json();

        const summary = data.investments
          .map(
            (inv) => `
  • ${inv.name} [${inv.riskLevel} Risk]
	Category: ${inv.category}
	Recommended: R${inv.recommendedAmount}
	Expected Return: ${inv.expectedReturn}
	ESG Score: ${inv.esgScore}/100
	  `
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: summary.trim() }],
        };
      }
    );
  }
}
