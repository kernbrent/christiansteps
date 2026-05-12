const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
];

const dayNames = [
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat"
];

fetch('data/calendar.json')
.then(response => response.json())
.then(events => {

    const calendarContainer =
        document.getElementById('calendarContainer');

    const monthNav =
        document.getElementById('monthNav');

    const groupedMonths = {};

    events.forEach(event => {

        const date = new Date(event.Date);

        const month = date.getMonth();

        if(!groupedMonths[month]){
            groupedMonths[month] = [];
        }

        groupedMonths[month].push(event);

    });

    Object.keys(groupedMonths).forEach(monthKey => {

        const month = parseInt(monthKey);

        // NAV BUTTON

        const navButton =
            document.createElement('a');

        navButton.href =
            `#month-${month}`;

        navButton.innerText =
            monthNames[month];

        monthNav.appendChild(navButton);

        // CALENDAR

        const section =
            document.createElement('section');

        section.className =
            'month-calendar-section';

        section.id =
            `month-${month}`;

        const title =
            document.createElement('h2');

        title.innerText =
            `${monthNames[month]} 2026`;

        section.appendChild(title);

        const grid =
            document.createElement('div');

        grid.className =
            'calendar-grid';

        // DAYS OF WEEK

        dayNames.forEach(day => {

            const dayHeader =
                document.createElement('div');

            dayHeader.className =
                'calendar-day-header';

            dayHeader.innerText =
                day;

            grid.appendChild(dayHeader);

        });

        const firstDay =
            new Date(2026, month, 1);

        const startingDay =
            firstDay.getDay();

        const daysInMonth =
            new Date(2026, month + 1, 0).getDate();

        // EMPTY BOXES

        for(let i=0; i<startingDay; i++){

            const empty =
                document.createElement('div');

            empty.className =
                'calendar-day empty';

            grid.appendChild(empty);

        }

        // DAYS

        for(let day=1; day<=daysInMonth; day++){

            const cell =
                document.createElement('div');

            cell.className =
                'calendar-day';

            const dateString =
                `2026-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

            const eventsForDay =
                groupedMonths[month].filter(
                    e => e.Date === dateString
                );

            cell.innerHTML =
                `<div class="day-number">${day}</div>`;

            eventsForDay.forEach(event => {

                const eventDiv =
                    document.createElement('div');

                eventDiv.className =
                    `event-card ${event.EventType.toLowerCase()}`;

                let html =
                    `
                    <div class="event-type">
                        ${event.EventType}
                    </div>

                    <div class="event-time">
                        ${event.Time}
                    </div>

                    <div class="event-location">
                        ${event.Location}
                    </div>
                    `;

                if(event.FieldNumber){

                    html +=
                        `
                        <div class="event-field">
                            ${event.FieldNumber}
                        </div>
                        `;
                }

                if(event.EventType === "Game" &&
                    event.Opponent){

                    html +=
                        `
                        <div class="event-opponent">
                            vs ${event.Opponent}
                        </div>
                        `;
                }

                eventDiv.innerHTML = html;

                cell.appendChild(eventDiv);

            });

            grid.appendChild(cell);

        }

        section.appendChild(grid);

        calendarContainer.appendChild(section);

    });

});