import {VNode, div, label, input, hr, h1, button, makeDOMDriver, p as Para} from '@cycle/dom';
import {DOMSource} from '@cycle/dom/xstream-typings'
import xs, {Stream, MemoryStream} from 'xstream'

export type Sources = {
  DOM: DOMSource
}

export type Sinks = {
  DOM: Stream<VNode>
}

/* ****** ****** */
// simple view/presenter: text box + computation that depends on it

type Presenter = {
  nametext: (name$:Stream<string>) => Stream<string>
}

// to construct a view, have to supply a presenter, that specifies
// how certain processing is to be carried out
function view (dom: DOMSource, presenter: Presenter): Stream<VNode> {
  let name$ = dom.select('.field').events('input')
      .map(ev => (ev.target as HTMLInputElement).value)
      .startWith('')
  let value$ = presenter.nametext(name$)
  
  let vtree$ = xs.combine(name$, value$).map(([name, value]) =>
      div('#root', [
        h1('Greetings'),

        label('Name:'),
        input('.field', {attributes: {type: 'text', value: name}}),

        Para(value),
      ])
    )

  return vtree$
}

let presenter = {
  nametext: function(e: Stream<string>): Stream<string> {
    return e.map(name => name?`Hello, ${name}!`:'Hello! Please enter your name...');
  }
}

/* ****** ****** */
// counter

enum CounterCmd { Inc, Dec }

type PresenterCounter = {
  currentCount: (cmd$:Stream<CounterCmd>) => Stream<number>
}

function viewCounter (dom: DOMSource, presenter: PresenterCounter): Stream<VNode> {
  let action$ = xs.merge(
    dom.select('.decrement').events('click').map(ev => CounterCmd.Dec),
    dom.select('.increment').events('click').map(ev => CounterCmd.Inc)
  );
  let count$ = presenter.currentCount(action$).map(num => num.toLocaleString());
  let vtree$ =
    count$.map(count =>
        div([
          h1('Counter example (no pun intended)'),
          button('.decrement', 'Decrement'),
          button('.increment', 'Increment'),
          Para('Counter: ' + count)
        ])
    )
  return vtree$
}

function
presenterCounter() {
  let init = 0
  return {
    currentCount: (cmd: Stream<CounterCmd>): Stream<number> => {
      let cnt$ = cmd.map(c => c == CounterCmd.Inc? +1 : -1).fold((x, y) => x + y, init)

      return cnt$
    }
  }
}

/* ****** ****** */
// main routine

export function App (sources: Sources): Sinks {

  let greeting = view(sources.DOM, presenter)
  let counter = viewCounter(sources.DOM, presenterCounter())

  const sinks = {
    DOM:
      xs.combine(greeting, counter).map(([greeting, counter]) => div ([greeting, hr(), counter]))
  }
  return sinks
}
