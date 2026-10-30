const p = (text, kw) => ({ text, kw })

export const RUBRICS = {
  'Given an array of integers and a target, return the indices of the two numbers that add up to the target.':
    [
      p('uses a hash map from value to index', 'hash|map|dict|object|словар|хеш|хэш'),
      p(
        'looks up the complement (target minus current) while iterating',
        'complement|target\\s*-|дополн|разниц|недостающ'
      ),
      p('single pass, O(n) time', 'O\\(n\\)'),
      p('O(n) extra space and returns indices, not values', 'space|памят|индекс|indices')
    ],
  'Write a function that checks whether a string of brackets ()[]{} is balanced.': [
    p('uses a stack', 'stack|стек'),
    p('push opening brackets, pop and compare on closing', 'pop'),
    p(
      'maps each closing bracket to its opening one',
      'map|dict|pairs|словар|соответств|\\{\\s*[\'"]?\\)'
    ),
    p('empty stack at the end, O(n) time', 'O\\(n\\)')
  ],
  'Merge two sorted linked lists into one sorted list.': [
    p('compare the heads and take the smaller node', 'smaller|min|<=?|меньш'),
    p('dummy head node to simplify building the result', 'dummy|sentinel|фиктив|заглуш'),
    p(
      'append the remaining tail of the non-empty list',
      'remain|rest|tail|остав|остат|хвост|\\|\\||\\bor\\b'
    ),
    p(
      'O(n+m) time, O(1) extra space when relinking',
      'O\\(\\s*(n\\s*\\+\\s*m|m\\s*\\+\\s*n)\\s*\\)'
    )
  ],
  'Реализуй LRU-кэш с операциями get и put за O(1).': [
    p('hash map for O(1) key lookup', 'hash|map|dict|словар|хеш|хэш'),
    p('doubly linked list ordered by recency', 'doubly|двусвяз|linked|OrderedDict'),
    p('get moves the entry to the most recent position', 'move|recent|недавн|переме|move_to_end'),
    p(
      'put evicts the least recently used entry when over capacity',
      'evict|capacity|вытес|удал|ёмкост|емкост|popitem|popleft|shift'
    )
  ],
  'Найди самую длинную подстроку без повторяющихся символов.': [
    p('sliding window with two pointers', 'window|окн|two pointers|два указател|left|start'),
    p('map or set of seen characters / last index', 'set|map|dict|словар|множеств|last|seen'),
    p(
      'move the left edge past the previous occurrence on a repeat',
      'left|start|дубл|повтор|repeat|duplicate'
    ),
    p('O(n) time', 'O\\(n\\)')
  ],
  'Given a binary tree, return its level-order traversal as a list of lists.': [
    p('breadth-first search with a queue', 'queue|deque|очеред|bfs'),
    p(
      'process one level at a time using the current queue size',
      'len\\(|size|length|размер|уровн|level'
    ),
    p('collect each level into its own list', 'level|уровн|append|push'),
    p('O(n) time and space', 'O\\(n\\)')
  ],
  'Напиши функцию debounce на JavaScript.': [
    p('returns a wrapper function that delays the call', 'return|возвращ'),
    p('clears the previous timer on each call', 'clearTimeout'),
    p('sets a new setTimeout with the delay', 'setTimeout'),
    p('preserves this and arguments (apply or spread)', 'apply|\\.\\.\\.args|arguments|call\\(')
  ],
  'Find the k-th largest element in an unsorted array.': [
    p('min-heap of size k', 'heap|куч'),
    p(
      'the heap root is the answer after processing all elements',
      'root|top|\\[0\\]|peek|корен|верш|heappop'
    ),
    p('O(n log k) time, O(k) space', 'O\\(\\s*n\\s*log\\s*k\\s*\\)'),
    p(
      'quickselect gives O(n) average as the alternative',
      'quickselect|quick select|быстр\\w* выбор|O\\(n\\)'
    )
  ],
  'Tell me about a time you disagreed with your manager.': [
    p(
      'sets a concrete situation and what the disagreement was about',
      'situation|ситуац|when|once|раз|проект|project|decid|реш'
    ),
    p(
      'shows own action: raised it respectfully with data or reasoning',
      'data|reason|argument|данн|аргумент|обсуд|talk|discuss|explain|объясн|предлож|propos'
    ),
    p(
      'stays professional and commits to the final decision',
      'decision|commit|respect|решени|уваж|поддерж|agree|договор'
    ),
    p(
      'states the outcome or what was learned',
      'result|outcome|learn|итог|результат|урок|вывод|в итоге'
    )
  ],
  'Расскажи о своём самом сложном проекте.': [
    p('names the project and its context or scale', 'проект|project'),
    p('names the specific difficulty', 'сложн|труд|проблем|difficult|challeng'),
    p(
      'describes own action or decision',
      'я |мы |сделал|решил|предложил|внедр|реализ|\\bI\\b|\\bwe\\b'
    ),
    p('states the result or lesson', 'результат|итог|в итоге|урок|вывод|result|outcome|learn')
  ],
  'What is the difference between TCP and UDP?': [
    p('TCP is connection-oriented, UDP is connectionless', 'connection'),
    p(
      'TCP guarantees delivery, ordering and retransmission; UDP does not',
      'reliab|deliver|order|retransmi|guarantee'
    ),
    p('UDP is faster with lower overhead', 'fast|overhead|latency|lightweight|low'),
    p(
      'use cases: TCP for web/files, UDP for streaming/games/DNS/VoIP',
      'stream|game|video|voip|dns|http|file|web'
    )
  ],
  'Why do you want to work at our company?': [
    p(
      'shows specific interest in the company, product or mission',
      'product|mission|company|продукт|миссия|компани'
    ),
    p(
      'connects the candidate skills or experience to the role',
      'experience|skill|опыт|навык|background|role|роль'
    ),
    p(
      'mentions what the candidate hopes to contribute or learn',
      'contribut|learn|grow|вклад|научи|рост|help|помо'
    ),
    p('does not rely on salary as the main reason', '^(?![^]*(salary|зарплат|money))')
  ],
  'Какие правила работы с ключами и для чего их ещё используют?': [
    p('a key is stable and unique among siblings', 'стабильн|уникальн|stable|unique'),
    p('array index breaks on reorder, insert or remove', 'индекс|index'),
    p('key is not available as a prop', 'props|пропс|не попадает|не достать|not available'),
    p(
      'changing the key remounts the component and resets its state',
      'сброс|пересозд|remount|reset|состояни|state'
    )
  ],
  'Explain how the event loop works in JavaScript.': [
    p('JavaScript is single-threaded with one call stack', 'single|call stack|one thread|стек'),
    p(
      'async work is handled outside the stack by Web APIs / the runtime',
      'web api|runtime|browser|node|libuv|timer'
    ),
    p('finished callbacks wait in a queue until the stack is empty', 'queue|очеред'),
    p('microtasks (promises) run before macrotasks (timers)', 'microtask|promise|микротаск|промис')
  ],
  'Чем useMemo отличается от useCallback и когда их стоит применять?': [
    p('useMemo caches a computed value', 'значени|value|результат|result'),
    p('useCallback caches the function itself', 'функци|function'),
    p(
      'useCallback(fn, deps) is equivalent to useMemo(() => fn, deps)',
      'useMemo\\(\\s*\\(\\)\\s*=>|эквивалент|equivalent|то же|тоже|по сути'
    ),
    p(
      'use them for expensive calculations or stable references passed to memoized children, not by default',
      'тяжёл|тяжел|дорог|expensive|ссылк|reference|React\\.memo|не везде|premature|измер'
    )
  ],
  'What are the trade-offs between SQL and NoSQL databases?': [
    p(
      'SQL: fixed schema, relations, joins and ACID transactions',
      'schema|join|acid|transaction|relation|схем|транзакц'
    ),
    p(
      'NoSQL: flexible schema for varied or changing data',
      'flexible|schemaless|schema-less|document|гибк'
    ),
    p('NoSQL typically scales horizontally more easily', 'horizontal|scal|shard|масштаб'),
    p(
      'NoSQL often trades consistency or complex queries for scale and speed',
      'consisten|eventual|query|queries|консистент|trade'
    )
  ]
}
