function tokenizeSentence(sentence = "") {
  const chunks = sentence.match(/\s+|[A-Za-z']+|[^A-Za-z'\s]+/g) || [];
  return chunks.map((chunk) => {
    const isWord = /^[A-Za-z']+$/.test(chunk);
    return {
      text: chunk,
      isWord,
      word: isWord ? chunk.toLowerCase() : "",
    };
  });
}

function extractWordsFromSentence(sentence = "") {
  const matches = sentence.match(/[A-Za-z']+/g) || [];
  return matches.map((word) => word.toLowerCase());
}

function extractUniqueWordsFromSentences(sentences = [], limit = 2000) {
  const wordSet = new Set();
  for (let i = 0; i < sentences.length; i += 1) {
    const words = extractWordsFromSentence(sentences[i].english || "");
    for (let j = 0; j < words.length; j += 1) {
      wordSet.add(words[j]);
      if (wordSet.size >= limit) {
        break;
      }
    }
    if (wordSet.size >= limit) {
      break;
    }
  }
  return Array.from(wordSet).sort((a, b) => a.localeCompare(b));
}

function guessWordForms(word = "") {
  const base = (word || "").toLowerCase().trim();
  if (!base) {
    return [];
  }

  const forms = [];
  const pushForm = (label, value) => {
    forms.push({
      label,
      value,
    });
  };

  pushForm("原形", base);

  if (base.endsWith("y") && !/[aeiou]y$/.test(base)) {
    pushForm("复数", `${base.slice(0, -1)}ies`);
  } else if (/(s|x|z|ch|sh)$/.test(base)) {
    pushForm("复数", `${base}es`);
  } else {
    pushForm("复数", `${base}s`);
  }

  if (base.endsWith("e")) {
    pushForm("过去式", `${base}d`);
    pushForm("过去分词", `${base}d`);
    pushForm("现在分词", `${base.slice(0, -1)}ing`);
  } else if (base.endsWith("y") && !/[aeiou]y$/.test(base)) {
    pushForm("过去式", `${base.slice(0, -1)}ied`);
    pushForm("过去分词", `${base.slice(0, -1)}ied`);
    pushForm("现在分词", `${base}ing`);
  } else {
    pushForm("过去式", `${base}ed`);
    pushForm("过去分词", `${base}ed`);
    pushForm("现在分词", `${base}ing`);
  }

  return forms;
}

module.exports = {
  tokenizeSentence,
  extractWordsFromSentence,
  extractUniqueWordsFromSentences,
  guessWordForms,
};
