import {VNode, div, label, input, hr, h1, button, makeDOMDriver, p as Para, select, option} from '@cycle/dom';
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
// List selection

type PresenterListSel = {
  selectedValues: (selectedIndex: Stream<number>) => {choices: Stream<string[]>, selected: Stream<string>}
}

function viewListSel (dom: DOMSource, presenter: PresenterListSel): Stream<VNode> {
  let action$ = xs.merge(
    dom.select('.select')
      .events('change')
      .map(ev => {
        let target = ev.target as HTMLSelectElement
        return target.selectedIndex
      })
      .startWith(-1)
  );
  let {choices:choices$,selected:selected$} = presenter.selectedValues(action$);
  let vtree$ =
    xs.combine(choices$, selected$).map(([choices, selected]) =>
        div([
          h1('List selection example'),
          select('.select', choices.map((v) => option(v))),
          // FIXME: it seems that [combine] will pass [undefined] for events that didn't happen
          // so we have to include some logic here
          Para('You selected: ' + (selected === undefined? 'Nothing' : selected))
        ])
    )
  return vtree$
}

function
presenterListSel() {
  // simple case: the list of choices is static, set only once
  let init = ['Audi', 'Volkswagen', 'Ford', 'Skoda']
  let init$ = xs.fromArray([init])
  return {
    selectedValues: (selected$: Stream<number>): {choices: Stream<string[]>, selected: Stream<string>} => {
      let sel$ = selected$.map(selected => selected < -1 || selected > init.length? 'Nothing' : init[selected]);

      return {choices: init$, selected: sel$};
    }
  }
}

/* ****** ****** */
// main routine

export function App (sources: Sources): Sinks {

  let greeting = view(sources.DOM, presenter)
  let counter = viewCounter(sources.DOM, presenterCounter())
  let listSel = viewListSel(sources.DOM, presenterListSel())

  const sinks = {
    DOM:
      xs.combine(greeting, counter, listSel).map(([greeting, counter, listSel]) => div ([greeting, hr(), counter, hr(), listSel]))
  }

  return sinks
}
