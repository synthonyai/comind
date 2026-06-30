// lib/embeddings.ts

interface EmbeddingRequest {
  content: string
  instructionType: 'memory' | 'query' | 'knowledge'
  privacyLevel: 'private' | 'shareable' | 'public'
}

interface HuggingFaceEmbeddingResponse {
  embedding?: number[]
  error?: string
}

// Using BAAI/bge-large-en-v1.5 - confirmed available and 1024 dimensions
const EMBEDDING_MODEL = 'BAAI/bge-large-en-v1.5'
const HUGGINGFACE_API_URL = `https://router.huggingface.co/hf-inference/models/${EMBEDDING_MODEL}`

/**
 * Generate embeddings using HuggingFace Inference API
 * Model: BAAI/bge-large-en-v1.5 (1024 dimensions)
 */
async function callHuggingFaceEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.HUGGINGFACE_API_KEY

  if (!apiKey) {
    console.error('❌ HUGGINGFACE_API_KEY environment variable is not set')
    throw new Error('HuggingFace API key not configured')
  }

  try {
    console.log(`🔄 Generating embedding for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`)
    
    const response = await fetch(HUGGINGFACE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: text,
        options: {
          wait_for_model: true, // Wait if model is loading
          use_cache: false // Get fresh embeddings
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ HuggingFace API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      })
      
      if (response.status === 503) {
        throw new Error('Model is currently loading. Please try again in a moment.')
      }
      
      throw new Error(`HuggingFace API error: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    
    // Handle different response formats
    let embedding: number[]
    
    if (Array.isArray(result)) {
      // If result is directly an array of numbers
      embedding = result
    } else if (result.embedding && Array.isArray(result.embedding)) {
      // If result has embedding property
      embedding = result.embedding
    } else if (result[0] && Array.isArray(result[0])) {
      // If result is array of arrays, take first
      embedding = result[0]
    } else {
      console.error('❌ Unexpected response format:', result)
      throw new Error('Unexpected response format from HuggingFace API')
    }

    // Verify dimensions
    if (embedding.length !== 1024) {
      console.warn(`⚠️ Expected 1024 dimensions, got ${embedding.length}`)
    }

    console.log(`✅ Generated embedding with ${embedding.length} dimensions`)
    return embedding

  } catch (error) {
    console.error('❌ Error calling HuggingFace API:', error)
    
    if (error instanceof Error) {
      // Re-throw with more context
      throw new Error(`Failed to generate embedding: ${error.message}`)
    }
    
    throw new Error('Failed to generate embedding: Unknown error')
  }
}

/**
 * Generate embedding for memory content
 */
export async function generateEmbedding(request: EmbeddingRequest): Promise<number[] | null> {
  try {
    // Add context prefix for better embeddings
    let processedContent = request.content
    
    switch (request.instructionType) {
      case 'memory':
        // For memories, we can add minimal context
        processedContent = `Memory: ${request.content}`
        break
      case 'query':
        // For queries, add search context
        processedContent = `Search query: ${request.content}`
        break
      case 'knowledge':
        // For knowledge, keep as-is or add minimal context
        processedContent = `Knowledge: ${request.content}`
        break
    }

    return await callHuggingFaceEmbedding(processedContent)
    
  } catch (error) {
    console.error('❌ generateEmbedding failed:', error)
    return null
  }
}

/**
 * Generate embedding specifically for search queries
 */
export async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  return generateEmbedding({
    content: query,
    instructionType: 'query',
    privacyLevel: 'private' // Queries are typically private
  })
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have the same length')
  }

  let dotProduct = 0
  let magnitude1 = 0
  let magnitude2 = 0

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i]
    magnitude1 += embedding1[i] * embedding1[i]
    magnitude2 += embedding2[i] * embedding2[i]
  }

  magnitude1 = Math.sqrt(magnitude1)
  magnitude2 = Math.sqrt(magnitude2)

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0 // Avoid division by zero
  }

  const similarity = dotProduct / (magnitude1 * magnitude2)
  
  // Clamp to [-1, 1] range due to floating point precision
  return Math.max(-1, Math.min(1, similarity))
}

/**
 * Find most similar embeddings from a list
 */
export function findMostSimilar(
  queryEmbedding: number[], 
  candidateEmbeddings: { id: string; embedding: number[] }[],
  topK: number = 5
): { id: string; similarity: number }[] {
  
  const similarities = candidateEmbeddings.map(candidate => ({
    id: candidate.id,
    similarity: calculateCosineSimilarity(queryEmbedding, candidate.embedding)
  }))

  // Sort by similarity (highest first) and take top K
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}

/**
 * Batch generate embeddings for multiple texts
 */
export async function generateBatchEmbeddings(
  requests: EmbeddingRequest[]
): Promise<(number[] | null)[]> {
  
  // For now, process sequentially to avoid rate limits
  // In production, you might want to add batching or concurrency control
  const embeddings: (number[] | null)[] = []
  
  for (const request of requests) {
    try {
      const embedding = await generateEmbedding(request)
      embeddings.push(embedding)
      
      // Add small delay to be respectful to API
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error('❌ Batch embedding failed for:', request.content.substring(0, 50))
      embeddings.push(null)
    }
  }
  
  return embeddings
}

/**
 * Utility to check if embedding dimensions are valid
 */
export function validateEmbedding(embedding: number[]): boolean {
  return (
    Array.isArray(embedding) &&
    embedding.length === 1024 &&
    embedding.every(val => typeof val === 'number' && !isNaN(val))
  )
}

export { EMBEDDING_MODEL }